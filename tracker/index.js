
const pathlib = require('path')
const chokidar = require('chokidar')

const Album = require('../../photos-common/models/album')
const Photo = require('../../photos-common/models/photo')

let Q = null
let HOST = '*'

let albumDB = null
let photoDB = null

let wereQueueOperations = false

async function handleActive () {
  wereQueueOperations = true
}

async function handleCompleted (job, res) {
  const userId = job.data.userId
  console.log(res.albums.length, res.photos.length, job.data.path)

  // merge albums
  {
    res.albums = await Promise.all(res.albums.map(Album.newDocument))
    const inDB = await albumDB.children(userId, job.data.parentId, Album.projections.physical)
    const { insert, remain, update } = Album.merge(inDB, res.albums)
    // insert
    const insertedIds = await albumDB.insert(insert)
    insert.forEach((el, i) => (el.id = insertedIds[i]))
    // remain
    await albumDB.popProcessingFlags(remain, '@scan')
    // update
    for (const ud of update) {
      await albumDB.update(ud.id, ud.update)
    }
    await albumDB.popProcessingFlags(update.map(ud => ud.id), '@scan')
  }

  // merge photos
  {
    res.photos = await Promise.all(res.photos.map(Photo.newDocument))
    const inDB = await photoDB.children(userId, job.data.parentId, Photo.projections.physical)
    const { insert, remain, update } = Photo.merge(inDB, res.photos)
    // insert
    await photoDB.insert(insert)
    // remain
    await photoDB.popProcessingFlags(remain, '@scan')
    // update
    for (const ud of update) {
      await photoDB.update(ud.query, ud.update)
    }
  }

  // recursion
  for (const a of res.albums) {
    await Q.add({
      userId: a.userId,
      parentId: a.id,
      path: a.path
    })
  }
}

async function init ({ colls, queue, processorQueue = null, host = '*', processes = 1 }) {
  // queue
  Q = queue
  Q.process(HOST, processes, pathlib.join(__dirname, './DirectoryScanner.proc.js'))
  // roots
  HOST = host
  // DBs
  albumDB = new Album(colls.albums)
  photoDB = new Photo(colls.photos, { host, processorQueue })

  Q.on('active', handleActive)
  Q.on('completed', handleCompleted)

  Q.on('drained', async () => {
    wereQueueOperations = false
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        if (!wereQueueOperations && await Q.count() === 0) {
          const query = { _processingFlags: '@scan' }
          await albumDB.deleteMany(query)
          await photoDB.deleteMany(query)
          console.log('marked cleared')
        }
        resolve()
      }, 8000)
    }).catch(console.error)
  })

  await Q.resume()
}

async function stop () {
  await Q.pause()
}

async function scan (userId, root) {
  if (!userId) throw new Error(`'userId' is not defined for the path '${root}'`)
  console.log(`Tracker.scan(root:'${root}', userId:'${userId}')`)
  const pathPrefixRegEx = new RegExp('^' + root)
  const query = { userId, path: { $regex: pathPrefixRegEx } }
  await albumDB.pushProcessingFlags(query, '@scan')
  await photoDB.pushProcessingFlags(query, '@scan')
  wereQueueOperations = true
  await Q.add(HOST, {
    userId,
    parentId: null,
    path: root
  })
}

async function watch (userId, root) {
  console.log(`Watching '${root}'`)
  const watcher = chokidar.watch(root, {
    ignored: /(^|[/\\])\../,
    ignoreInitial: true,
    followSymlinks: false,
    usePolling: false,
    depth: 64,
    awaitWriteFinish: true,
    atomic: 1000
  })
  watcher
    .on('addDir', async (path) => {
      const parent = await albumDB.findOne({ path: pathlib.dirname(path) }, Album.projections.id)
      if (parent) {
        const newAlbum = await Album.newDocument({ userId, parentId: parent.id, path }, { getStats: true })
        await albumDB.insert(newAlbum)
        console.log(path, parent.id, 'addDir')
      }
    })
    .on('unlinkDir', async (path) => {
      await albumDB.deleteOne({ path })
      console.log(path, 'unlinkDir')
    })
    .on('add', async (path) => {
      const parent = await albumDB.findOne({ path: pathlib.dirname(path) }, Album.projections.id)
      if (parent) {
        const newPhoto = await Photo.newDocument({ userId, parentId: parent.id, path }, { getStats: true })
        if (Photo.allowedFileTypes.includes(newPhoto.extension)) {
          await photoDB.insert(newPhoto)
          console.log(path, parent.id, 'add')
        }
      }
    })
    .on('unlink', async (path) => {
      await photoDB.deleteMany({ path })
      console.log(path, 'unlink')
    })
}

module.exports = {
  init,
  stop,
  scan,
  watch
}

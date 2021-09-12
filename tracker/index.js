
const pathlib = require('path')
const chokidar = require('chokidar')

const Album = require('../../photos-common/models/album2')
const Photo = require('../../photos-common/models/photo2')

const { pathPrefixRegExp } = require('../../photos-common/utils')

let Q = null
let HOST = '*'

let wereQueueOperations = false

async function handleActive () {
  wereQueueOperations = true
}

async function deleteRemainingUnprocessed (query) {
  await Album.delete(query)
  await Photo.delete(query)
}

async function handleCompleted (job, res) {
  const albumId = job.data.albumId
  res.albums = await Promise.all(res.albums.map(album => Album.newDocument(album)))
  res.photos = await Promise.all(res.photos.map(photo => Photo.newDocument(photo)))
  const logline = []

  // merge albums
  {
    const inDB = await Album.children(albumId, Album.projections.physical())
    const { insert, remain, update } = Album.merge(inDB, res.albums)
    logline.push(insert.length, update.length, remain.length, '|')
    // insert
    await Album.insert(insert)
    // remain
    await Album.popProcessingFlags(remain, '@scan')
    // update
    await Album.save(update)
    await Album.popProcessingFlags(update, '@scan')
  }

  // merge photos
  {
    const inDB = await Photo.children(albumId, Photo.projections.physical())
    const { insert, remain, update } = Photo.merge(inDB, res.photos)
    logline.push(insert.length, update.length, remain.length, '|')
    // insert
    await Photo.insert(insert)
    // remain
    await Photo.popProcessingFlags(remain, '@scan')
    // update
    for (const ud of update) {
      await Photo.update(ud.query, ud.update)
    }
  }

  console.log(...logline, job.data.path)

  // cleanup
  await deleteRemainingUnprocessed({ albumId, _processingFlags: '@scan' })

  // recursion
  for (const a of res.albums) {
    await Q.add({
      userId: a.userId,
      albumId: a.id,
      path: a.path
    })
  }
}

async function init ({ colls, queue, processorQueue = null, convertedCache = null, host = '*', processes = 1 }) {
  // queue
  Q = queue
  Q.process(HOST, processes, pathlib.join(__dirname, './DirectoryScanner.proc.js'))
  // roots
  HOST = host
  // DBs
  Album.init({ coll: colls.albums })
  Photo.init({
    coll: colls.photos,
    host,
    processorQueue,
    convertedCache
  })

  Q.on('active', handleActive)
  Q.on('completed', handleCompleted)

  Q.on('drained', async () => {
    wereQueueOperations = false
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        if (!wereQueueOperations && await Q.count() === 0) {
          await deleteRemainingUnprocessed({ _processingFlags: '@scan' })
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
  const query = { userId, path: pathPrefixRegExp(root) }
  await Album.pushProcessingFlags(query, '@scan')
  await Photo.pushProcessingFlags(query, '@scan')
  wereQueueOperations = true
  await Q.add(HOST, {
    userId,
    albumId: null,
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
      const parent = await Album.findOne({ path: pathlib.dirname(path) }, Album.projections.id)
      if (parent) {
        const newAlbum = await Album.newDocument({ userId, albumId: parent.id, path }, { getStats: true })
        await Album.insert(newAlbum)
        console.log(path, parent.id, 'addDir')
      }
    })
    .on('unlinkDir', async (path) => {
      await Album.delete({ path })
      console.log(path, 'unlinkDir')
    })
    .on('add', async (path) => {
      const parent = await Album.findOne({ path: pathlib.dirname(path) }, Album.projections.id)
      if (parent) {
        const newPhoto = await Photo.newDocument({ userId, albumId: parent.id, path }, { getStats: true })
        if (Photo.allowedFileTypes.includes(newPhoto.extension)) {
          await Photo.insert(newPhoto)
          console.log(path, parent.id, 'add')
        }
      }
    })
    .on('unlink', async (path) => {
      await Photo.delete({ path })
      console.log(path, 'unlink')
    })
}

module.exports = {
  init,
  stop,
  scan,
  watch
}

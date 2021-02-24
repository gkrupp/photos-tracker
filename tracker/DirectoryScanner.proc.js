const fs = require('fs')
const path = require('path')
const Album = require('../../photos-common/models/album')
const Photo = require('../../photos-common/models/photo')

async function listRoot (rootPath, userId, rootName = '@') {
  const photos = []
  const albums = [await Album.newDocument({ userId, path: rootPath, fileName: rootName }, { getStats: true })]
  return { albums, photos }
}

async function listPath (rootPath, userId, parentId) {
  const files = await fs.promises.readdir(rootPath, { withFileTypes: true })
  const photos = []
  const albums = []
  for (const item of files) {
    const itemPath = path.resolve(rootPath, item.name)
    if (item.isDirectory() && !item.name.startsWith('.')) {
      albums.push(
        await Album.newDocument({ path: itemPath, userId, parentId }, { getStats: true })
      )
    } else if (item.isFile() && Photo.allowedFileTypes.includes(path.extname(item.name).toLowerCase())) {
      photos.push(
        await Photo.newDocument({ userId, parentId, path: itemPath }, { getStats: true })
      )
    }
  }
  return { albums, photos }
}

module.exports = async function DirectoryScanner ({ data }) {
  try {
    // scan root directory
    if (!data.parentId) {
      return await listRoot(data.path, data.userId)
    // subdirectory
    } else {
      return await listPath(data.path, data.userId, data.parentId)
    }
  } catch (err) {
    console.error(err)
    return {
      albums: [],
      photos: []
    }
  }
}

require('dotenv')

module.exports = {
  tracker: {
    roots: process.env.TRACKER_ROOTS.split(',').map((root, i) => {
      return {
        path: root,
        userId: process.env.TRACKER_USERS.split(',')[i]
      }
    }),
    startup: Boolean(process.env.TRACKER_STARTUP) || false,
    watch: Boolean(process.env.TRACKER_WATCH) || false
  },
  proc: {
    host: process.env.PROC_HOST,
    queuePrefix: process.env.PROC_QUEUE_PREFIX,
    processes: Number(process.env.PROC_NUMBER),
    logLevel: process.env.PROC_LOG_LEVEL
  },
  queues: {
    tracker: process.env.QUEUE_TRACKER,
    processor: process.env.QUEUE_PROCESSOR
  },
  caches: {
    thumbnails: {
      root: process.env.CACHE_THUMBNAILS_ROOT,
      levels: Number(process.env.CACHE_THUMBNAILS_LEVELS),
      expire: Number(process.env.CACHE_THUMBNAILS_EXPIRE)
    },
    converted: {
      root: process.env.CACHE_CONVERTED_ROOT,
      levels: Number(process.env.CACHE_CONVERTED_LEVELS),
      expire: Number(process.env.CACHE_CONVERTED_EXPIRE)
    }
  },
  redis: {
    host: process.env.RD_HOST,
    password: process.env.RD_PWD
  },
  mongo: {
    uri: process.env.MONGO_URI,
    db: process.env.MONGO_DB,
    collections: {
      users: process.env.MONGO_COLL_USERS,
      albums: process.env.MONGO_COLL_ALBUMS,
      photos: process.env.MONGO_COLL_PHOTOS
    },
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  }
}

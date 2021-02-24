const dotenv = require('dotenv')
dotenv.config({ path: './config/.env' })
const config = require('./config')

const MongoDBService = require('../photos-common/services/MongoDBService')
const QueueService = require('../photos-common/services/QueueService')
const Tracker = require('./tracker')

async function init () {
  // DB init
  await MongoDBService.init(config.mongo)
  // Queue init
  await QueueService.init({ redis: config.redis })
  const trackerQueue = QueueService.create([config.proc.queuePrefix, config.queues.tracker].join(''))
  const processorQueue = QueueService.create([config.proc.queuePrefix, config.queues.processor].join(''))
  // Tracker init
  await Tracker.init({
    colls: MongoDBService.colls,
    queue: trackerQueue,
    processorQueue: processorQueue,
    host: config.proc.host,
    processes: config.proc.processes
  })

  // Process start signal
  process.send = process.send || (() => {})
  process.send('ready')

  // Startup and Watch
  for (const trackerConf of config.tracker.roots) {
    if (config.tracker.watch) await Tracker.watch(trackerConf.userId, trackerConf.path)
    if (config.tracker.startup) await Tracker.scan(trackerConf.userId, trackerConf.path)
  }
}

async function stop () {
  console.log('Shutting down..')
  try {
    await Tracker.stop()
    await QueueService.stop()
    await MongoDBService.stop()
  } catch (err) {
    return process.exit(1)
  }
  return process.exit(0)
}

init()

process.on('SIGINT', () => {
  stop()
})

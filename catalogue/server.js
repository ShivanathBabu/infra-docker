const instana = require('@instana/collector');
// init tracing MUST be done before anything else
instana({ tracing: { enabled: true } });

const { MongoClient } = require('mongodb');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

const logger = pino({ level: 'info', prettyPrint: false, useLevelLabels: true });
const expLogger = expPino({ logger });

let db;
let collection;
let mongoConnected = false;

const app = express();
app.use(expLogger);

// CORS & Timing-Allow-Origin headers
app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

// Instana custom annotation
app.use((req, res, next) => {
    const dcs = ["asia-northeast2","asia-south1","europe-west3","us-east1","us-west1"];
    const span = instana.currentSpan();
    span.annotate('custom.sdk.tags.datacenter', dcs[Math.floor(Math.random() * dcs.length)]);
    next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => res.json({ app: 'OK', mongo: mongoConnected }));

// Existing routes
app.get('/products', (req, res) => {
    if (!mongoConnected) return res.status(500).send('database not available');
    collection.find({}).toArray()
        .then(products => res.json(products))
        .catch(e => { req.log.error('ERROR', e); res.status(500).send(e); });
});

app.get('/product/:sku', (req, res) => {
    if (!mongoConnected) return res.status(500).send('database not available');
    const delay = process.env.GO_SLOW || 0;
    setTimeout(() => {
        collection.findOne({ sku: req.params.sku })
            .then(product => product ? res.json(product) : res.status(404).send('SKU not found'))
            .catch(e => { req.log.error('ERROR', e); res.status(500).send(e); });
    }, delay);
});

app.get('/products/:cat', (req, res) => {
    if (!mongoConnected) return res.status(500).send('database not available');
    collection.find({ categories: req.params.cat }).sort({ name: 1 }).toArray()
        .then(products => res.json(products.length ? products : []))
        .catch(e => { req.log.error('ERROR', e); res.status(500).send(e); });
});

app.get('/categories', (req, res) => {
    if (!mongoConnected) return res.status(500).send('database not available');
    collection.distinct('categories')
        .then(categories => res.json(categories))
        .catch(e => { req.log.error('ERROR', e); res.status(500).send(e); });
});

app.get('/search/:text', (req, res) => {
    if (!mongoConnected) return res.status(500).send('database not available');
    collection.find({ '$text': { '$search': req.params.text } }).toArray()
        .then(hits => res.json(hits))
        .catch(e => { req.log.error('ERROR', e); res.status(500).send(e); });
});

// ✅ New route: /uniqueid
app.get('/uniqueid', (req, res) => {
    res.json({ id: Math.floor(Math.random() * 1000000) });
});

// MongoDB connection
async function mongoConnect() {
    try {
        const mongoURL = process.env.MONGO_URL || 'mongodb://mongodb:27017/catalogue';
        const client = await MongoClient.connect(mongoURL, { useNewUrlParser: true, useUnifiedTopology: true });
        db = client.db('catalogue');
        collection = db.collection('products');
        mongoConnected = true;
        logger.info('MongoDB connected');
    } catch (error) {
        mongoConnected = false;
        logger.error('ERROR', error);
        setTimeout(mongoLoop, 2000);
    }
}

// Retry loop
function mongoLoop() {
    mongoConnect().catch(e => { logger.error('ERROR', e); setTimeout(mongoLoop, 2000); });
}

mongoLoop();

// Export app for inspection/testing
module.exports = app;

// Start server only if run directly
if (require.main === module) {
    const port = process.env.CATALOGUE_SERVER_PORT || '8080';
    app.listen(port, () => logger.info('Started on port', port));
}

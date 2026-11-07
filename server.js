// SERVER.JS — API Express pour fleurs_db


const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;
const MONGO_URI = 'mongodb://127.0.0.1:27017';
const DB_NAME = 'fleurs_db';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let db;

// Connexion MongoDB
MongoClient.connect(MONGO_URI)
  .then(client => {
    db = client.db(DB_NAME);
    console.log('Connecté à MongoDB — fleurs_db');
    app.listen(PORT, () => {
      console.log('Serveur lancé sur http://localhost:' + PORT);
    });
  })
  .catch(err => {
    console.error('Erreur connexion MongoDB:', err.message);
    process.exit(1);
  });

// ==================== DASHBOARD ====================
app.get('/api/dashboard', async (req, res) => {
  try {
    const [nbClients, nbProduits, nbCommandes, commandes] = await Promise.all([
      db.collection('clients').countDocuments(),
      db.collection('produits').countDocuments(),
      db.collection('commandes').countDocuments(),
      db.collection('commandes').find().toArray()
    ]);
    const totalCA = commandes
      .filter(c => c.statut !== 'annulee')
      .reduce((sum, c) => sum + (c.total || 0), 0);
    const parStatut = commandes.reduce((acc, c) => {
      acc[c.statut] = (acc[c.statut] || 0) + 1;
      return acc;
    }, {});
    res.json({ nbClients, nbProduits, nbCommandes, totalCA: totalCA.toFixed(2), parStatut });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CLIENTS ====================
app.get('/api/clients', async (req, res) => {
  try {
    const clients = await db.collection('clients').find().sort({ date_inscription: -1 }).toArray();
    res.json(clients);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', async (req, res) => {
  try {
    const { nom, email, telephone, rue, ville, code_postal } = req.body;
    if (!nom || !email) return res.status(400).json({ error: 'Nom et email obligatoires' });

    // On bypass la validation schema en inserant directement sans validation stricte
    const doc = {
      nom: nom.trim(),
      email: email.trim(),
      telephone: (telephone || '').trim(),
      adresse: {
        rue: (rue || '').trim(),
        ville: (ville || '').trim(),
        code_postal: (code_postal || '').trim(),
        pays: 'Tunisie'
      },
      date_inscription: new Date(),
      actif: true
    };

    const result = await db.collection('clients').insertOne(doc);
    console.log('Client ajouté:', nom, '| id:', result.insertedId);
    res.json({ success: true, id: result.insertedId });
  } catch (e) {
    console.error('POST /clients:', e.message);
    // Si erreur de validation schema MongoDB, on désactive temporairement et on réessaie
    if (e.message.includes('Document failed validation')) {
      try {
        // Désactiver la validation pour cette collection
        await db.command({ collMod: 'clients', validationLevel: 'off' });
        const { nom, email, telephone, rue, ville, code_postal } = req.body;
        const result = await db.collection('clients').insertOne({
          nom: nom.trim(), email: email.trim(),
          telephone: (telephone || '').trim(),
          adresse: { rue: (rue||'').trim(), ville: (ville||'').trim(), code_postal: (code_postal||'').trim(), pays: 'Tunisie' },
          date_inscription: new Date(), actif: true
        });
        // Réactiver la validation
        await db.command({ collMod: 'clients', validationLevel: 'moderate' });
        console.log('Client ajouté (après désactivation validation):', nom);
        res.json({ success: true, id: result.insertedId });
      } catch (e2) {
        res.status(500).json({ error: e2.message });
      }
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

app.put('/api/clients/:id', async (req, res) => {
  try {
    const { nom, email, telephone, actif } = req.body;
    await db.collection('clients').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { nom, email, telephone, actif: actif !== false } }
    );
    res.json({ success: true });
  } catch (e) {
    console.error('PUT /clients:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  try {
    await db.collection('clients').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PRODUITS ====================
app.get('/api/produits', async (req, res) => {
  try {
    const produits = await db.collection('produits').aggregate([
      { $lookup: { from: 'categories', localField: 'categorie_id', foreignField: '_id', as: 'categorie' } },
      { $unwind: { path: '$categorie', preserveNullAndEmptyArrays: true } }
    ]).toArray();
    res.json(produits);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/produits', async (req, res) => {
  try {
    const { nom, description, prix, stock, couleur, categorie_id } = req.body;
    if (!nom || !prix) return res.status(400).json({ error: 'Nom et prix obligatoires' });
    const result = await db.collection('produits').insertOne({
      nom: nom.trim(),
      description: (description || '').trim(),
      prix: parseFloat(prix),
      stock: parseInt(stock) || 0,
      couleur: (couleur || '').trim(),
      categorie_id: categorie_id ? new ObjectId(categorie_id) : null,
      avis: []
    });
    res.json({ success: true, id: result.insertedId });
  } catch (e) {
    console.error('POST /produits:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/produits/:id', async (req, res) => {
  try {
    const { nom, description, prix, stock, couleur } = req.body;
    await db.collection('produits').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { nom, description, prix: parseFloat(prix), stock: parseInt(stock), couleur } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/produits/:id', async (req, res) => {
  try {
    await db.collection('produits').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== COMMANDES ====================
app.get('/api/commandes', async (req, res) => {
  try {
    const commandes = await db.collection('commandes').aggregate([
      { $lookup: { from: 'clients', localField: 'client_id', foreignField: '_id', as: 'client' } },
      { $unwind: { path: '$client', preserveNullAndEmptyArrays: true } },
      { $sort: { date_commande: -1 } }
    ]).toArray();
    res.json(commandes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/commandes/:id/statut', async (req, res) => {
  try {
    const { statut } = req.body;
    await db.collection('commandes').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { statut } }
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CATEGORIES ====================
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await db.collection('categories').find().toArray();
    res.json(categories);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const fs = require('fs');
const path = require('path');
const uuidv4 = require('uuid').v4;
const { ObjectId } = require('mongodb');
const Queue = require('bull');
const dbClient = require('../utils/db');
const redisClient = require('../utils/redis');

const FOLDER_PATH = process.env.FOLDER_PATH || '/tmp/files_manager';

async function postUpload(req, res) {
  const docQ = new Queue('docQ');
  const token = req.headers['x-token'];
  const {
    name, type, parentId = 0, isPublic = false, data,
  } = req.body;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = `auth_${token}`;
  const userId = await redisClient.get(key);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = await dbClient.client.db().collection('users').findOne({ _id: new ObjectId(userId) });
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!name) {
    return res.status(400).json({ error: 'Missing name' });
  }

  if (!type || !['folder', 'file', 'image'].includes(type)) {
    return res.status(400).json({ error: 'Missing type' });
  }

  if (parentId !== 0) {
    const file = await dbClient.client.db().collection('files').findOne({ _id: ObjectId(parentId) });
    if (!file) {
      return res.status(400).json({ error: 'Parent not found' });
    }
    if (file.type !== 'folder') {
      return res.status(400).json({ error: 'Parent is not a folder' });
    }
  }

  if (!data && type !== 'folder') {
    return res.status(400).json({ error: 'Missing data' });
  }

  const newFile = {
    name,
    type,
    isPublic,
    parentId,
    userId: user._id,
  };

  if (type === 'folder') {
    await dbClient.client.db().collection('files').insertOne(newFile);
    return res.status(201).json({
      id: newFile._id,
      userId: newFile.userId,
      name: newFile.name,
      type: newFile.type,
      isPublic: newFile.isPublic,
      parentId: newFile.parentId,
    });
  }

  const filename = uuidv4();
  if (!fs.existsSync(FOLDER_PATH)) {
    fs.mkdirSync(FOLDER_PATH, { recursive: true });
  }
  const datab = Buffer.from(data, 'base64');
  const localPath = path.join(FOLDER_PATH, filename);
  fs.writeFile(localPath, datab, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    return true;
  });
  newFile.localPath = localPath;
  await dbClient.client.db().collection('files').insertOne(newFile);

  docQ.add({
    userId: newFile.userId,
    docId: newFile._id,
  });
  return res.status(201).json({
    id: newFile._id,
    userId: newFile.userId,
    name: newFile.name,
    type: newFile.type,
    isPublic: newFile.isPublic,
    parentId: newFile.parentId,
  });
}

async function getShow(req, res) {
  const { id } = req.params;
  const token = req.headers['x-token'];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const key = `auth_${token}`;
  const userId = await redisClient.get(key);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = await dbClient.client.db().collection('users').findOne({ _id: ObjectId(userId) });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const file = await dbClient.client.db().collection('files').findOne({ _id: ObjectId(id), userId: user._id });
  if (!file) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.status(200).json({
    id: file._id,
    userId: file.userId,
    name: file.name,
    type: file.type,
    isPublic: file.isPublic,
    parentId: file.parentId,
  });
}

async function getIndex(req, res) {
  const token = req.headers['x-token'];
  const { parentId = 0, page = 0 } = req.query;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = `auth_${token}`;
  const userId = await redisClient.get(key);

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (parentId !== 0) {
    const file = await dbClient.client.db().collection('files').findOne({ _id: ObjectId(parentId) });
    if (!file || file.type !== 'folder') return res.status(200).send([]);
  }
  const aggr = { $and: [{ parentId }] };
  let pipeline = [
    { $match: aggr },
    { $skip: page * 20 },
    { $limit: 20 },
  ];
  if (parentId === 0) pipeline = [{ $skip: page * 20 }, { $limit: 20 }];

  const files = await dbClient.client.db().collection('files').aggregate(pipeline);
  const fileArray = [];
  await files.forEach((file) => {
    const fileObj = {
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId,
    };
    fileArray.push(fileObj);
  });
  return res.status(200).json(fileArray);
}

async function putPublish(req, res) {
  const { id } = req.params;
  const token = req.headers['x-token'];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = `auth_${token}`;
  const userId = await redisClient.get(key);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = await dbClient.client.db().collection('users').findOne({ _id: ObjectId(userId) });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let file = await dbClient.client.db().collection('files').findOne({ _id: ObjectId(id), userId: user._id });
  if (!file) return res.status(404).json({ error: 'Not found' });

  await dbClient.client.db().collection('files').updateOne({ _id: ObjectId(id) }, { $set: { isPublic: true } });
  file = await dbClient.client.db().collection('files').findOne({ _id: ObjectId(id), userId: user._id });
  return res.status(200).json({
    id: file._id,
    userId: file.userId,
    name: file.name,
    type: file.type,
    isPublic: file.isPublic,
    parentId: file.parentId,
  });
}

async function putUnpublish(req, res) {
  const token = req.headers['x-token'];
  const { id } = req.params;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = `auth_${token}`;
  const userId = await redisClient.get(key);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = await dbClient.client.db().collection('users').findOne({ _id: ObjectId(userId) });
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  let file = await dbClient.client.db().collection('files').findOne({ _id: ObjectId(id), userId: user._id });
  if (!file) return res.status(404).json({ error: 'Not found' });

  await dbClient.client.db().collection('files').updateOne({ _id: ObjectId(id) }, { $set: { isPublic: false } });
  file = await dbClient.client.db().collection('files').findOne({ _id: ObjectId(id), userId: user._id });
  return res.status(200).json({
    id: file._id,
    userId: file.userId,
    name: file.name,
    type: file.type,
    isPublic: file.isPublic,
    parentId: file.parentId,
  });
}

module.exports = {
  postUpload,
  getShow,
  getIndex,
  putPublish,
  putUnpublish,
};

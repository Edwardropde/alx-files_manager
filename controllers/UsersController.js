import sha1 from 'sha1';
import { ObjectID } from 'mongodb';
import Queue from 'bull';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const userQueue = new Queue('userQueue', 'redis://127.0.0.1:6379');

class UsersController {
  static async postNew(req, res) {
    try {
      const { email, password } = req.body;
      if (!email) {
        res.status(400).json({ error: 'Missing email' });
      }
      if (!password) {
        res.status(400).json({ error: 'Missing password' });
      }

      const users = dbClient.db.collection('users');
      const existingUser = await users.findOne({ email });

      if (existingUser) {
        res.status(400).json({ error: 'Already exist' });
      }

      const hashedPassword = sha1(password);
      const result = await users.insertOne({
        email,
        password: hashedPassword,
      });

      res.status(201).json({ id: result.insertedId, email });
      userQueue.add({ userId: result.insertedId });
      return;
    } catch (err) {
      res.status(500).json({ error: err });
    }
  }

  static async getMe(req, res) {
    try {
      const token = req.header('X-Token');
      const key = `auth_${token}`;
      const userId = await redisClient.get(key);

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
      }

      const users = dbClient.db.collection('users');
      const user = await users.findOne({ _id: new ObjectID(userId) });
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
      }
      res.status(200).json({ id: userId, email: user.email });
      return;
    } catch (err) {
      res.status(500).json({ error: err });
    }
  }
}

module.exports = UsersController;

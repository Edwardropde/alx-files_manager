import sha1 from 'sha1';
import { v4 as uuidv4 } from 'uuid';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

class AuthController {
  static async getConnect(req, res) {
    try {
      const authData = req.header('Authorization');
      if (!authData) {
        res.status(401).json({ error: 'Authorization header missing' });
      }

      let userEmail = authData.split(' ')[1];
      const buff = Buffer.from(userEmail, 'base64');
      userEmail = buff.toString('ascii');
      const data = userEmail.split(':'); // contains email and password
      if (data.length !== 2) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const hashedPassword = sha1(data[1]);
      const users = dbClient.db.collection('users');
      const user = await users.findOne({
        email: data[0],
        password: hashedPassword,
      });

      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
      }

      const token = uuidv4();
      const key = `auth_${token}`;
      await redisClient.set(key, user._id.toString(), 60 * 60 * 24);
      res.status(200).json({ token });
    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  }

  static async getDisconnect(req, res) {
    try {
      const token = req.header('X-Token');
      if (!token) {
        res.status(401).json({ error: 'X-Token header missing' });
      }

      const key = `auth_${token}`;
      const id = await redisClient.get(key);
      if (!id) {
        res.status(401).json({ error: 'Unauthorized' });
      }

      await redisClient.del(key);
      res.status(204).json({});
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = AuthController;

import express from 'express';
import logger from 'morgan';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { Server } from 'socket.io';
import { createServer } from 'node:http';

dotenv.config();

const port = 3005;

const app = express();
const server = createServer(app);
const io = new Server(server, {
    connectionStateRecovery: {}
});

const db = createClient({
    url: process.env.DB_URL,
    authToken: process.env.DB_TOKEN
});

await db.execute(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    username TEXT NOT NULL,
    room TEXT
  )
`);

io.on('connection', async (socket ) => {
    console.log(`a user connected with socketid: ${socket.id} and username: ${socket.handshake.auth.username}`);

    socket.on('disconnect', () => {
        console.log(`a user disconnected with id: ${socket.id} and username: ${socket.handshake.auth.username} from room: ${socket.currentRoom}`);
    });

    socket.on('join room', async(room) => {
        // salir de la sala anterior si existe
        if (socket.currentRoom) {
            socket.leave(socket.currentRoom);
            console.log(`User ${socket.handshake.auth.username} left room: ${socket.currentRoom}`);
        }
        socket.currentRoom = room;
        socket.join(room);
        console.log(`User ${socket.handshake.auth.username} socketid ${socket.id} joined room: ${room}`);
        
         if (!socket.recovered) {
        try {
            const results = await db.execute({
                sql: 'SELECT id, content, username, room FROM messages WHERE room = :room AND id > :offset',// solo traer mensajes de la sala actual :offset es el ultimo mensaje que el cliente recibio
                args: { room: socket.currentRoom, offset: socket.handshake.auth.serverOffset ?? 0 }
            });

            results.rows.forEach((row) => {
                socket.emit('chat message', row.content, row.id.toString(), row.username, row.room);
            });
        } catch (e) {
            console.error(e);
        }
    }
    });

    socket.on('chat message', async (msg) => {
        let result;
        const username = socket.handshake.auth.username ?? 'anonymous';
        const room = socket.currentRoom;

        if (!msg) {
            return;
        }

        try {
            result = await db.execute({
                sql: 'INSERT INTO messages (content, username, room) VALUES (:msg, :username, :room)',
                args: { msg, username, room }
            });
        } catch (e) {
            console.error(e);
            return;
        }

        io.to(room).emit('chat message', msg, result.lastInsertRowid.toString(), username, room);
    });

   
});

app.use(logger('dev'));

app.get('/', (req, res) => {
    res.sendFile(process.cwd() + '/Public/index.html');
});

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
const File = require("../models/file");
const fs = require("fs");
const path = require("path");
const { isTextFile } = require("../helpers/isTextFile");
const { resolveAbsolutePath } = require("../configuration/file_system");

// Base directory from your controller
const BASE_DIR =
  process.env.FILE_STORAGE_PATH || path.join("C:", "CC-USER-FILES");

const getUserDir = (userId) => {
  if (userId.includes("..") || path.isAbsolute(userId)) {
    throw new Error("Invalid user ID");
  }
  return path.join(BASE_DIR, userId);
};

const saveFileContent = (filePath, content) => {
  fs.writeFileSync(filePath, content, "utf8");
};

const joinFile = async (socket, { fileId }, io) => {
  try {
    const file = await File.findById(fileId);
    if (!file) {
      return socket.emit("ERROR", { message: "File not found" });
    }

    // Verify file exists in filesystem
    const absolutePath = path.join(BASE_DIR, file.path);
    if (!fs.existsSync(absolutePath)) {
      // Recreate file if missing
      saveFileContent(absolutePath, file.content || "");
    }

    // Get fresh content from filesystem for text files
    const content = isTextFile(file.name)
      ? fs.readFileSync(absolutePath, "utf8")
      : file.content;

    socket.join(`file:${fileId}`);
    socket.emit("FILE_JOINED", {
      fileId,
      content,
      users: Array.from(
        io.sockets.adapter.rooms.get(`file:${fileId}`)?.size || 1
      ),
    });

    console.log(`User ${socket.id} joined file ${fileId}`);
  } catch (err) {
    socket.emit("ERROR", { message: "Failed to join file" });
    console.error(err);
  }
};

// In your socket handlers file
const getFileContent = async (socket, { filePath, userId }, callback) => {
  try {
    const userDir = getUserDir(userId);
    const absolutePath = path.join(userDir, filePath);
    
    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      // Return empty content for new files
      return callback({ content: '' });
    }
    

    // Read file content
    const content = fs.readFileSync(absolutePath, 'utf8');
    
    // Broadcast to other clients in this file
    socket.to(`file:${filePath}`).emit("FILE_CONTENT", {
      filePath,
      content,
      userId,
      updatedAt: new Date()
    });

    // Respond to the requesting client
    callback({ content });
    
  } catch (err) {
    console.error("File fetch failed:", err);
    callback({ error: err.message });
  }
};

const updateFileContent = async (socket, { filePath, userId, content }, io) => {
  try {
    const userDir = getUserDir(userId);
    const absolutePath = path.join(userDir, filePath);
    console.log("absolute path:", absolutePath);

    // 1. Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 2. Atomic write with verification
    fs.writeFileSync(absolutePath, content, 'utf8');
    const fd = fs.openSync(absolutePath, 'r+');
    fs.fsyncSync(fd); // Force physical write
    fs.closeSync(fd);

    // 3. Verify the write
    const verify = fs.readFileSync(absolutePath, 'utf8');
    if (verify !== content) {
      throw new Error('Write verification failed');
    }

    io.to(`file:${filePath}`).emit("FILE_CONTENT_UPDATED", {
      filePath,
      content: verify,
      userId,
      updatedAt: new Date()
    })

    // 4. Emit success via socket
    socket.emit("FILE_UPDATED", {
      filePath,
      content: verify,
      userId,
      updatedAt: new Date()
    });

    // 5. Broadcast to other clients
    socket.to(`user:${userId}`).emit("FILE_UPDATED_REMOTE", {
      filePath,
      content
    });

  } catch (err) {
    console.error("File update failed:", err);
    socket.emit("FILE_UPDATE_ERROR", {
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
};

const updateCursorPosition = (socket, { fileId, position }, io) => {
  try {
    socket.to(`file:${fileId}`).emit("FILE_CURSOR", {
      userId: socket.id,
      position,
    });
  } catch (err) {
    socket.emit("ERROR", { message: "Failed to update cursor position" });
    console.error(err);
  }
};

const leaveFile = (socket, { fileId }, io) => {
  try {
    socket.leave(`file:${fileId}`);
    socket.emit("FILE_LEFT", { fileId });
    console.log(`User ${socket.id} left file ${fileId}`);
  } catch (err) {
    socket.emit("ERROR", { message: "Failed to leave file" });
    console.error(err);
  }
};

const registerFileHandlers = (io, socket) => {
  socket.on("JOIN_FILE", (data) => joinFile(socket, data, io));
  socket.on("FILE_CONTENT", (data, callback) => getFileContent(socket, data, callback));
  socket.on("UPDATE_FILE", async (data) => {
    try {
      console.log("Recieved data: ", data);
      await updateFileContent(socket, data, io);
    } catch (err) {
      console.log("error: ", err);
    }
  });
  socket.on("FILE_CURSOR", (data) => updateCursorPosition(socket, data, io));
  socket.on("LEAVE_FILE", (data) => leaveFile(socket, data, io));
};

module.exports = registerFileHandlers;

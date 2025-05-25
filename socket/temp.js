// Add these imports at the top




// Update registerFileHandlers
const registerFileHandlers = (io, socket) => {
  socket.on("JOIN_FILE", (data) => joinFile(socket, data, io));
  socket.on("FILE_CONTENT", (data, callback) => getFileContent(socket, data, callback));
  socket.on("UPDATE_FILE", async (data) => {
    try {
      console.log("Received data: ", data);
      await updateFileContent(socket, data, io);
    } catch (err) {
      console.log("error: ", err);
    }
  });
 
};
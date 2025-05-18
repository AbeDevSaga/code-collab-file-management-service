/**
 * File Operation Handlers
 * Processes WebSocket messages related to file operations
 */

const File = require('../models/file');

module.exports = {
  handle: async (data, ws, services) => {
    const { connections, rooms, broadcaster } = services;
    
    try {
      switch(data.type) {
        case 'join_file':
          await handleJoinFile(data, ws, services);
          break;
          
        case 'file_edit':
          await handleFileEdit(data, ws, services);
          break;
          
        case 'file_save':
          await handleFileSave(data, ws, services);
          break;
          
        default:
          broadcaster.sendError(ws, 'Unknown message type');
      }
    } catch (error) {
      console.error('Error handling file operation:', error);
      broadcaster.sendError(ws, error.message);
    }
  }
};

async function handleJoinFile(data, ws, { rooms, broadcaster }) {
  const { fileId } = data;
  const clientId = ws._clientId;
  
  rooms.join(`file:${fileId}`, clientId);
  
  broadcaster.send(ws, {
    type: 'file_joined',
    fileId,
    timestamp: Date.now()
  });
}

async function handleFileEdit(data, ws, { broadcaster, rooms }) {
  const { fileId, changes } = data;
  const clientId = ws._clientId;
  
  // Broadcast changes to others in the same file room
  broadcaster.broadcastToRoom(
    `file:${fileId}`,
    {
      type: 'file_update',
      fileId,
      changes,
      sender: clientId,
      timestamp: Date.now()
    },
    clientId // Exclude sender
  );
  
  // Here you would typically:
  // 1. Validate changes
  // 2. Apply operational transforms if needed
  // 3. Queue for persistence
}

async function handleFileSave(data, ws, { broadcaster }) {
  const { fileId, content } = data;
  
  try {
    // Save to database
    const file = await File.findByIdAndUpdate(
      fileId,
      { content, updatedAt: Date.now() },
      { new: true }
    );
    
    if (!file) {
      throw new Error('File not found');
    }
    
    broadcaster.send(ws, {
      type: 'file_saved',
      fileId,
      timestamp: Date.now()
    });
    
  } catch (error) {
    console.error('Error saving file:', error);
    broadcaster.sendError(ws, 'Failed to save file');
  }
}
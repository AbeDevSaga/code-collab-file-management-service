const File = require("../models/file");
const fs = require("fs");
const dotenv = require("dotenv");
const path = require("path");
const mime = require("mime-types"); // You'll need to install this: npm install mime-types
const { isTextFile } = require("../helpers/isTextFile");

// Base directory for all user files
// C:\CC-USER-FILES
const BASE_DIR =
  process.env.FILE_STORAGE_PATH || path.join("C:", "CC-USER-FILES");
if (!fs.existsSync(BASE_DIR)) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

// Helper function to get user directory
const getUserDir = (userId) => {
  // Sanitize userId to prevent directory traversal
  if (userId.includes("..") || path.isAbsolute(userId)) {
    throw new Error("Invalid user ID");
  }
  const userDir = path.join(BASE_DIR, userId);
  if (!fs.existsSync(userDir)) {
    try {
      fs.mkdirSync(userDir, { recursive: true });
      console.log(`Created user directory at ${userDir}`);
    } catch (err) {
      console.error(`Failed to create user directory: ${err}`);
      throw err;
    }
  }

  return userDir;
};

// Create or update file content immediately
const saveFileContent = (filePath, content) => {
  fs.writeFileSync(filePath, content, "utf8");
};

const createFile = async (req, res) => {
  console.log("createFile");
  try {
    const {
      name,
      type,
      path: filePathInput,
      project,
      organization,
      content,
    } = req.body;
    const createdBy = req.user.id.toString();

    console.log("Request body:", req.body);

    // Validate required fields
    if (!name || !type || filePathInput === undefined) {
      return res
        .status(400)
        .json({ error: "Name, type, and path are required" });
    }

    // Create user directory if it doesn't exist
    const userDir = getUserDir(createdBy);
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // Normalize and clean the path
    let normalizedPath = filePathInput;

    // Handle path separators
    normalizedPath = normalizedPath.replace(/\\/g, "/"); // Convert all to forward slashes
    normalizedPath = normalizedPath.replace(/^\/|\/$/g, ""); // Remove leading/trailing slashes

    console.log("Normalized path:", normalizedPath);

    // Split path into segments
    const pathSegments = normalizedPath
      .split("/")
      .filter((segment) => segment.trim() !== "");
    console.log("Path segments:", pathSegments);

    // Build the full path starting from user directory
    let currentPath = userDir;

    // Create all intermediate directories if they don't exist
    for (const segment of pathSegments) {
      currentPath = path.join(currentPath, segment);
      console.log("Creating intermediate path:", currentPath);

      if (!fs.existsSync(currentPath)) {
        fs.mkdirSync(currentPath);
      }
    }

    let fullPath;
    let size = 0;
    let extension = "";

    if (type === "file") {
      // Handle file creation
      extension = path.extname(name).toLowerCase();
      fullPath = path.join(currentPath, name);
      console.log("Creating file at:", fullPath);

      // Create file with content if provided
      if (content !== undefined) {
        saveFileContent(fullPath, content);
        size = fs.statSync(fullPath).size;
      } else {
        fs.writeFileSync(fullPath, "");
      }
    } else if (type === "folder") {
      // Handle folder creation
      fullPath = path.join(currentPath, name);
      console.log("Creating folder at:", fullPath);

      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath);
      } else {
        return res.status(400).json({ error: "Folder already exists" });
      }
    } else {
      return res.status(400).json({ error: "Invalid file type" });
    }

    const relativePath = path.relative(BASE_DIR, fullPath);
    console.log("Relative path to store in DB:", relativePath);

    const file = new File({
      name: name,
      type,
      path: relativePath,
      size,
      extension,
      createdBy,
      ...(project && { project }),
      ...(organization && { organization }),
      ...(type === "file" && { content: content || "" }),
    });

    await file.save();
    res.status(201).json({ message: "File created successfully", file });
  } catch (error) {
    console.error("Error creating file:", error);
    res.status(500).json({
      error: "File creation failed",
      details: error.message,
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    });
  }
};
const getEnhancedFileStructure = async (req, res) => {
  console.log("getEnhancedFileStructure");
  try {
    const createdBy = req.user.id.toString();
    const userDir = getUserDir(createdBy);

    if (!fs.existsSync(userDir)) {
      return res.status(200).json([]);
    }

    const buildTree = (dir, relativeBase) => {
      const result = [];
      const items = fs.readdirSync(dir, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(relativeBase, fullPath);

        const node = {
          _id: relativePath,
          name: item.name,
          path: relativePath,
          type: item.isDirectory() ? "folder" : "file",
          size: item.isFile() ? fs.statSync(fullPath).size : 0,
          extension: item.isFile() ? path.extname(item.name).toLowerCase() : "",
          mimeType: item.isFile()
            ? mime.lookup(item.name) || "application/octet-stream"
            : null,
          createdAt: fs.statSync(fullPath).birthtime,
          modifiedAt: fs.statSync(fullPath).mtime,
        };

        // For text-based files, include content
        if (item.isFile() && isTextFile(item.name)) {
          try {
            node.content = fs.readFileSync(fullPath, "utf-8").toString();
          } catch (readError) {
            node.content = "[Binary content - cannot display]";
          }
        }

        if (item.isDirectory()) {
          node.children = buildTree(fullPath, relativeBase);
          node.hasChildren = node.children.length > 0;
        }

        result.push(node);
      }

      // Sort folders first, then files
      return result.sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === "folder" ? -1 : 1;
      });
    };

    const fileStructure = buildTree(userDir, userDir);
    res.status(200).json(fileStructure);
  } catch (error) {
    console.error("Error getting file structure:", error);
    res.status(500).json({
      message: "Failed to get file structure",
      error: error.message,
    });
  }
};

const getFileContent = async (req, res) => {
  console.log("getFileContent");
  try {
    const { id } = req.params;
    const file = await File.findById(id);

    if (!file || file.isDeleted) {
      return res.status(404).json({ message: "File not found" });
    }

    if (file.type !== "file") {
      return res
        .status(400)
        .json({ message: "Requested resource is not a file" });
    }

    const absolutePath = path.join(BASE_DIR, file.path);

    if (!fs.existsSync(absolutePath)) {
      // If file doesn't exist in FS but exists in DB, recreate it
      fs.writeFileSync(absolutePath, file.content || "");
    }

    // Read fresh content from filesystem
    const content = fs.readFileSync(absolutePath, "utf8");

    res.status(200).json({
      ...file.toObject(),
      content,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get file content", error });
  }
};

const saveFile = async (req, res) => {
  console.log("saveFile");
  try {
    const { id } = req.params;
    const { content } = req.body;
    const broadcaster = req.broadcaster;

    const file = await File.findById(id);
    if (!file || file.isDeleted || file.type !== "file") {
      return res.status(404).json({ message: "File not found or not a file" });
    }

    const absolutePath = path.join(BASE_DIR, file.path);

    // Save to filesystem immediately
    saveFileContent(absolutePath, content);

    // Update in database
    File.findByIdAndUpdate(
      id,
      {
        content,
        size: Buffer.byteLength(content, "utf8"),
        updated_at: Date.now(),
      },
      { new: true }
    );

    // Broadcast update to all collaborators
    if (broadcaster) {
      broadcaster.broadcastToRoom(`file:${id}`, {
        type: "file_saved",
        fileId: id,
        content,
        timestamp: Date.now(),
      });
    }

    res.status(200).json({
      message: "File saved successfully",
      file: updatedFile,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to save file", error });
  }
};

const updateFile = async (req, res) => {
  console.log("updateFile");
  try {
    const { id } = req.params;
    const { name, content } = req.body;

    const file = await File.findById(id);
    if (!file || file.isDeleted) {
      return res.status(404).json({ message: "File not found" });
    }

    const oldAbsolutePath = path.join(BASE_DIR, file.path);
    const userDir = getUserDir(file.createdBy.toString());
    let newPath = oldAbsolutePath;

    // Handle rename if name changed
    if (name && name !== file.name) {
      newPath = path.join(userDir, name);

      if (fs.existsSync(newPath)) {
        return res
          .status(400)
          .json({ message: "A file with that name already exists" });
      }

      fs.renameSync(oldAbsolutePath, newPath);
    }

    // Handle content update for files
    if (content !== undefined && file.type === "file") {
      saveFileContent(newPath, content);
    }

    const updates = {
      name: name || file.name,
      path: path.relative(BASE_DIR, newPath),
      updated_at: Date.now(),
    };

    if (content !== undefined && file.type === "file") {
      updates.content = content;
      updates.size = Buffer.byteLength(content, "utf8");
    }

    const updatedFile = await File.findByIdAndUpdate(id, updates, {
      new: true,
    });
    res.status(200).json({
      message: "File updated successfully",
      file: updatedFile,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to update file", error });
  }
};

const deleteFile = async (req, res) => {
  console.log("deleteFile");
  try {
    const { id } = req.params;
    const file = await File.findById(id);

    if (!file) {
      return res.status(404).json({ message: "File not found" });
    }

    const absolutePath = path.join(BASE_DIR, file.path);

    // Always delete from filesystem
    try {
      if (file.type === "file" && fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      } else if (file.type === "folder" && fs.existsSync(absolutePath)) {
        fs.rmSync(absolutePath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error("Error deleting file from filesystem:", err);
    }

    // Delete from database
    await File.findByIdAndDelete(id);

    res.status(200).json({ message: "File deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete file", error });
  }
};

const listFiles = async (req, res) => {
  console.log("listFiles");
  try {
    const { project, organization } = req.query;
    const createdBy = req.user.id.toString();

    const query = { createdBy, isDeleted: false };
    if (project) query.project = project;
    if (organization) query.organization = organization;

    const files = await File.find(query).sort({ type: 1, name: 1 });

    res.status(200).json(files);
  } catch (error) {
    res.status(500).json({ message: "Failed to list files", error });
  }
};

const getFileStructure = async (req, res) => {
  console.log("getFileStructure");
  try {
    const createdBy = req.user.id.toString();
    const userDir = getUserDir(createdBy);

    if (!fs.existsSync(userDir)) {
      return res.status(200).json([]);
    }

    const buildTree = (dir) => {
      const result = [];
      const items = fs.readdirSync(dir, { withFileTypes: true });

      for (const item of items) {
        const fullPath = path.join(dir, item.name);
        const relativePath = path.relative(userDir, fullPath);

        const node = {
          name: item.name,
          path: relativePath,
          type: item.isDirectory() ? "folder" : "file",
          size: item.isFile() ? fs.statSync(fullPath).size : 0,
          extension: item.isFile() ? path.extname(item.name) : "",
        };

        if (item.isDirectory()) {
          node.children = buildTree(fullPath);
        }

        result.push(node);
      }

      return result;
    };

    const fileStructure = buildTree(userDir);
    res.status(200).json(fileStructure);
  } catch (error) {
    res.status(500).json({ message: "Failed to get file structure", error });
  }
};

module.exports = {
  createFile,
  getFileContent,
  saveFile,
  updateFile,
  deleteFile,
  listFiles,
  getFileStructure,
  getEnhancedFileStructure,
};

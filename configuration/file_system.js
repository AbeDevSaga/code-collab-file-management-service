const path = require("path");
const fs = require("fs");

const BASE_DIR =
  process.env.FILE_STORAGE_PATH || path.join("C:", "CC-USER-FILES");
if (!fs.existsSync(BASE_DIR)) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

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

module.exports = { getUserDir };

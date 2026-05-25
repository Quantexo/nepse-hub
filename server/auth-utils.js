const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

// Generate user code in format YYYYMMDDNNN
// Count existing users registered today, then increment
async function generateUniqueCode(supabase) {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const datePrefix = `${year}${month}${day}`;

  // Count users registered today with this date prefix in Supabase
  const { count, error } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .like("code", `${datePrefix}%`);

  if (error) {
    console.error("Error generating unique code:", error);
    throw new Error("Failed to generate unique code: " + error.message);
  }

  const userCount = (count || 0) + 1;
  const sequentialNumber = String(userCount).padStart(3, "0");
  const code = `${datePrefix}${sequentialNumber}`;

  return code;
}

// Hash password using bcrypt
async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// Compare password with hashed password
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// Generate JWT token
function generateAccessToken(userId, code) {
  const token = jwt.sign({ userId, code }, process.env.JWT_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY || "60m",
  });
  return token;
}

// Generate refresh token
function generateRefreshToken(userId, code) {
  const token = jwt.sign({ userId, code }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY || "7d",
  });
  return token;
}

// Verify JWT token
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (err) {
    return null;
  }
}

// Verify refresh token
function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    return decoded;
  } catch (err) {
    return null;
  }
}

// Extract token from Authorization header
function extractToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
}

module.exports = {
  generateUniqueCode,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  extractToken,
};

import jwt from 'jsonwebtoken';

// optionalAuth middleware - allows both authenticated and guest users
export const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  // If no auth header, continue as guest (req.user will be undefined)
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, email: decoded.email, name: decoded.name, role: decoded.role };
  } catch (err) {
    // Invalid token - continue as guest
    req.user = null;
  }
  next();
};

import jwt from "jsonwebtoken";

export const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    // verify token menggunakan secret yang sama dengan login
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ambil id, email, name, role dari JWT
    req.user = {
      id: decoded.id,       // harus sama dengan payload login
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error.message);
    return res.status(401).json({ message: "Token tidak valid" });
  }
};

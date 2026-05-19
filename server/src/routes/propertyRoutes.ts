import express from "express";
import {
  getProperties,
  getProperty,
  createProperty,
  updateProperty,
} from "../controllers/propertyControllers";
import multer from "multer";
import { authMiddleware, requireRole } from "../middleware/authMiddleware";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const router = express.Router();

router.get("/", getProperties);
router.get("/:id", getProperty);
router.post(
  "/",
  authMiddleware, requireRole(["manager"]),
  upload.array("photos"),
  createProperty
);
router.patch(
  "/:id",
  authMiddleware,
  requireRole(["manager"]),
  upload.array("photos"),
  updateProperty
);

export default router;

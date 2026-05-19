import express from "express";
import { authMiddleware, requireRole } from "../middleware/authMiddleware";
import {
  createApplication,
  listApplications,
  approveApplicationHandler,
} from "../controllers/applicationControllers";

const router = express.Router();

router.post("/", authMiddleware, requireRole(["tenant"]), createApplication);
router.patch("/:id/approve", authMiddleware, requireRole(["manager"]), approveApplicationHandler);
router.get("/", authMiddleware, requireRole(["manager", "tenant"]), listApplications);

export default router;

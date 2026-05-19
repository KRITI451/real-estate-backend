import express from "express";
import { authMiddleware, requireRole } from "../middleware/authMiddleware";
import { getLeasePayments, getLeases } from "../controllers/leaseControllers";

const router = express.Router();

router.get("/", authMiddleware, requireRole(["manager", "tenant"]), getLeases);
router.get(
  "/:id/payments",
  authMiddleware, requireRole(["manager", "tenant"]),
  getLeasePayments
);

export default router;

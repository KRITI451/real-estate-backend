import express from "express";
import {
  loginUser,
  registerUser,
  confirmSignUp,
} from "../controllers/authControllers";

const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/confirm", confirmSignUp);

export default router;

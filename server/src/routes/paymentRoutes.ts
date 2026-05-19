import express from "express";
import { payPayment } from "../controllers/paymentControllers.js";

const router = express.Router();

router.post("/:id/pay", async (req, res) => {
  const { amount } = req.body;

  const payment = await payPayment(req.params.id, amount);

  res.json(payment);
});

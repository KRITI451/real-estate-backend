import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const payPayment = async (
    paymentId: string,
    amount: number
  ) => {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
      });
  
      if (!payment) {
        throw new Error("Payment not found");
      }
  
      if (payment.paymentStatus === "Paid") {
        throw new Error("Already paid");
      }
  
      const newAmountPaid = payment.amountPaid + amount;
  
      if (newAmountPaid > payment.amountDue) {
        throw new Error("Overpayment not allowed");
      }
  
      let newStatus = "Pending";
  
      if (newAmountPaid === 0) {
        newStatus = "Pending";
      } else if (newAmountPaid < payment.amountDue) {
        newStatus = "PartiallyPaid";
      } else {
        newStatus = "Paid";
      }
  
      return await tx.payment.update({
        where: { id: paymentId },
        data: {
          amountPaid: newAmountPaid,
          paymentStatus: newStatus as any,
          paymentDate: newStatus === "Paid" ? new Date() : null,
        },
      });
    });
  };
  
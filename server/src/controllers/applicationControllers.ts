import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * LIST APPLICATIONS
 */
export const listApplications = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user!;

    let whereClause: any = {};

    if (user.role === "tenant") {
      whereClause = { tenantCognitoId: user.id };
    }

    if (user.role === "manager") {
      whereClause = {
        property: {
          managerCognitoId: user.id,
        },
      };
    }

    const applications = await prisma.application.findMany({
      where: whereClause,
      include: {
        property: {
          include: {
            location: true,
            manager: true,
          },
        },
        tenant: true,
        lease: true,
      },
    });

    const formatted = applications.map((app) => ({
      ...app,
      property: {
        ...app.property,
        address: app.property.location.address,
      },
      manager: app.property.manager,
    }));

    res.json(formatted);
  } catch (error: any) {
    res.status(500).json({
      message: `Error retrieving applications: ${error.message}`,
    });
  }
};

/**
 * CREATE APPLICATION
 */
export const createApplication = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user!;

    if (user.role.toLowerCase() !== "tenant") {
      res.status(403).json({ message: "Only tenants can apply" });
      return;
    }

    const { propertyId, name, email, phoneNumber, message } = req.body;

    if (!propertyId) {
      res.status(400).json({ message: "Property ID is required" });
      return;
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property) {
      res.status(404).json({ message: "Property not found" });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { cognitoId: user.id },
    });

    if (!tenant) {
      res.status(404).json({
        message: "Tenant profile not found. Please create a profile first.",
      });
      return;
    }

    const application = await prisma.application.create({
      data: {
        applicationDate: new Date(),
        status: "Pending",
        name: name || tenant.name,
        email: email || tenant.email,
        phoneNumber: phoneNumber || tenant.phoneNumber,
        message,
        propertyId,
        tenantCognitoId: user.id,
      },
      include: {
        property: true,
        tenant: true,
      },
    });

    res.status(201).json(application);
  } catch (error: any) {
    res.status(500).json({
      message: `Error creating application: ${error.message}`,
    });
  }
};

/**
 * UPDATE APPLICATION STATUS
 */
export const approveApplicationHandler = async (req: Request, res: Response) => {
  try {
    const lease = await approveApplication(
      req.params.id,
      req.user?.id
    );

    res.status(200).json(lease);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const approveApplication = async (
  applicationId: string,
  managerCognitoId?: string
) => {
  return await prisma.$transaction(async (tx) => {
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      include: {
        property: true,
      },
    });

    if (!application) {
      throw new Error("Application not found");
    }

    if (application.status !== "Pending") {
      throw new Error("Application already processed");
    }

    if (application.property.managerCognitoId !== managerCognitoId) {
      throw new Error("Unauthorized");
    }

    const activeLease = await tx.lease.findFirst({
      where: {
        propertyId: application.propertyId,
        status: "Active",
      },
    });

    if (activeLease) {
      throw new Error("Property already leased");
    }

    const startDate = new Date();

    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);

    const lease = await tx.lease.create({
      data: {
        startDate,
        endDate,
        rent: application.property.pricePerMonth,
        deposit: application.property.securityDeposit,
        propertyId: application.propertyId,
        tenantCognitoId: application.tenantCognitoId,
        status: "Active",
      },
    });

    await tx.application.update({
      where: { id: applicationId },
      data: {
        status: "Approved",
        leaseId: lease.id,
      },
    });

    // Security Deposit
    await tx.payment.create({
      data: {
        leaseId: lease.id,
        type: "SecurityDeposit",
        amountDue: application.property.securityDeposit,
        dueDate: startDate,
      },
    });

    // First Rent
    await tx.payment.create({
      data: {
        leaseId: lease.id,
        type: "Rent",
        amountDue: application.property.pricePerMonth,
        dueDate: startDate,
        billingMonth: new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          1
        ),
      },
    });

    return lease;
  });
};

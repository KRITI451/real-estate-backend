import { PrismaClient, Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const prisma = new PrismaClient();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function deterministicUuid(scope: string, rawId: string | number) {
  const hash = crypto
    .createHash("sha256")
    .update(`${scope}:${String(rawId)}`)
    .digest("hex");

  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${["8", "9", "a", "b"][parseInt(hash[16], 16) % 4]}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

function mapId(scope: string, rawId: string | number | undefined | null) {
  if (rawId === undefined || rawId === null) {
    return rawId;
  }

  return deterministicUuid(scope, rawId);
}

type LegacyRelationRef = {
  id: string | number;
};

function transformSeedItem(modelName: string, item: any) {
  switch (modelName) {
    case "Location":
      return {
        ...item,
        id: mapId("Location", item.id),
      };
    case "Manager":
      return {
        ...item,
        id: mapId("Manager", item.id),
      };
    case "Property":
      return {
        ...item,
        id: mapId("Property", item.id),
        locationId: mapId("Location", item.locationId),
      };
    case "Tenant":
      return {
        ...item,
        id: mapId("Tenant", item.id),
        properties: item.properties
          ? {
              connect: item.properties.connect.map((property: LegacyRelationRef) => ({
                id: mapId("Property", property.id),
              })),
            }
          : undefined,
        favorites: item.favorites
          ? {
              connect: item.favorites.connect.map((property: LegacyRelationRef) => ({
                id: mapId("Property", property.id),
              })),
            }
          : undefined,
      };
    case "Lease":
      return {
        ...item,
        id: mapId("Lease", item.id),
        propertyId: mapId("Property", item.propertyId),
      };
    case "Application":
      return {
        ...item,
        id: mapId("Application", item.id),
        propertyId: mapId("Property", item.propertyId),
        leaseId: mapId("Lease", item.leaseId),
      };
    case "Payment":
      return {
        ...item,
        lease: item.lease
          ? {
              connect: {
                id: mapId("Lease", item.lease.connect.id),
              },
            }
          : undefined,
      };
    default:
      return item;
  }
}

async function insertLocationData(locations: any[]) {
  for (const location of locations) {
    const { id, country, city, state, address, postalCode, coordinates } =
      location;
    try {
      await prisma.$executeRaw`
        INSERT INTO "Location" ("id", "country", "city", "state", "address", "postalCode", "coordinates") 
        VALUES (${id}, ${country}, ${city}, ${state}, ${address}, ${postalCode}, ST_GeomFromText(${coordinates}, 4326));
      `;
      console.log(`Inserted location for ${city}`);
    } catch (error) {
      console.error(`Error inserting location for ${city}:`, error);
    }
  }
}

async function deleteAllData(orderedFileNames: string[]) {
  const modelNames = orderedFileNames.map((fileName) => {
    return toPascalCase(path.basename(fileName, path.extname(fileName)));
  });

  for (const modelName of modelNames.reverse()) {
    const modelNameCamel = toCamelCase(modelName);
    const model = (prisma as any)[modelNameCamel];
    if (!model) {
      console.error(`Model ${modelName} not found in Prisma client`);
      continue;
    }
    try {
      await model.deleteMany({});
      console.log(`Cleared data from ${modelName}`);
    } catch (error) {
      console.error(`Error clearing data from ${modelName}:`, error);
    }
  }
}

async function main() {
  const dataDirectory = path.join(__dirname, "seedData");

  const orderedFileNames = [
    "location.json", // No dependencies
    "manager.json", // No dependencies
    "property.json", // Depends on location and manager
    "tenant.json", // No dependencies
    "lease.json", // Depends on property and tenant
    "application.json", // Depends on property and tenant
    "payment.json", // Depends on lease
  ];

  // Delete all existing data
  await deleteAllData(orderedFileNames);

  // Seed data
  for (const fileName of orderedFileNames) {
    const filePath = path.join(dataDirectory, fileName);
    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const modelName = toPascalCase(
      path.basename(fileName, path.extname(fileName))
    );
    const modelNameCamel = toCamelCase(modelName);
    const transformedData = jsonData.map((item: any) =>
      transformSeedItem(modelName, item)
    );

    if (modelName === "Location") {
      await insertLocationData(transformedData);
    } else {
      const model = (prisma as any)[modelNameCamel];
      try {
        for (const item of transformedData) {
          await model.create({
            data: item,
          });
        }
        console.log(`Seeded ${modelName} with data from ${fileName}`);
      } catch (error) {
        console.error(`Error seeding data for ${modelName}:`, error);
      }
    }

    await sleep(1000);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());

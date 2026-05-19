import { Request, Response } from "express";
import {
  PrismaClient,
  Prisma,
  Amenity,
  Highlight,
  PropertyType,
} from "@prisma/client";
import { wktToGeoJSON } from "@terraformer/wkt";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import axios from "axios";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

const s3Client = new S3Client({
  region: "ap-south-1",
  endpoint: "http://minio:9000",
  forcePathStyle: true,
  credentials: {
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin"
  }
});

type RawLocationRow = {
  id: string;
  address: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  coordinates: string;
};

const parseStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item): item is string => item.length > 0);
  }

  return undefined;
};

const parseBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.toLowerCase() === "true") {
      return true;
    }

    if (value.toLowerCase() === "false") {
      return false;
    }
  }

  return undefined;
};

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const uploadPropertyPhotos = async (
  files: Express.Multer.File[]
): Promise<string[]> => {
  const uploadedUrls = await Promise.all(
    files.map(async (file) => {
      const uploadParams = {
        Bucket: "properties",
        Key: `properties/${Date.now()}-${file.originalname}`,
        Body: file.buffer,
        ContentType: file.mimetype,
      };

      const uploadResult = await new Upload({
        client: s3Client,
        params: uploadParams,
      }).done();

      return uploadResult.Location;
    })
  );

  return uploadedUrls.filter((url): url is string => Boolean(url));
};

const getCoordinatesFromAddress = async ({
  address,
  city,
  country,
  postalCode,
}: {
  address: string;
  city: string;
  country: string;
  postalCode: string;
}): Promise<{ longitude: number; latitude: number }> => {
  const geocodingUrl = `https://nominatim.openstreetmap.org/search?${new URLSearchParams(
    {
      street: address,
      city,
      country,
      postalcode: postalCode,
      format: "json",
      limit: "1",
    }
  ).toString()}`;

  const geocodingResponse = await axios.get(geocodingUrl, {
    headers: {
      "User-Agent": "RealEstateApp (justsomedummyemail@gmail.com",
    },
  });

  if (geocodingResponse.data[0]?.lon && geocodingResponse.data[0]?.lat) {
    return {
      longitude: parseFloat(geocodingResponse.data[0].lon),
      latitude: parseFloat(geocodingResponse.data[0].lat),
    };
  }

  return { longitude: 0, latitude: 0 };
};

export const getProperties = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      favoriteIds,
      priceMin,
      priceMax,
      beds,
      baths,
      propertyType,
      squareFeetMin,
      squareFeetMax,
      amenities,
      availableFrom,
      latitude,
      longitude,
    } = req.query;

    let whereConditions: Prisma.Sql[] = [];

    if (favoriteIds) {
      const favoriteIdsArray = (favoriteIds as string)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      whereConditions.push(
        Prisma.sql`p.id IN (${Prisma.join(favoriteIdsArray)})`
      );
    }

    if (priceMin) {
      whereConditions.push(
        Prisma.sql`p."pricePerMonth" >= ${Number(priceMin)}`
      );
    }

    if (priceMax) {
      whereConditions.push(
        Prisma.sql`p."pricePerMonth" <= ${Number(priceMax)}`
      );
    }

    if (beds && beds !== "any") {
      whereConditions.push(Prisma.sql`p.beds >= ${Number(beds)}`);
    }

    if (baths && baths !== "any") {
      whereConditions.push(Prisma.sql`p.baths >= ${Number(baths)}`);
    }

    if (squareFeetMin) {
      whereConditions.push(
        Prisma.sql`p."squareFeet" >= ${Number(squareFeetMin)}`
      );
    }

    if (squareFeetMax) {
      whereConditions.push(
        Prisma.sql`p."squareFeet" <= ${Number(squareFeetMax)}`
      );
    }

    if (propertyType && propertyType !== "any") {
      whereConditions.push(
        Prisma.sql`p."propertyType" = ${propertyType}::"PropertyType"`
      );
    }

    if (amenities && amenities !== "any") {
      const amenitiesArray = (amenities as string).split(",");
      whereConditions.push(Prisma.sql`p.amenities @> ${amenitiesArray}`);
    }

    if (availableFrom && availableFrom !== "any") {
      const availableFromDate =
        typeof availableFrom === "string" ? availableFrom : null;
      if (availableFromDate) {
        const date = new Date(availableFromDate);
        if (!isNaN(date.getTime())) {
          whereConditions.push(
            Prisma.sql`EXISTS (
              SELECT 1 FROM "Lease" l 
              WHERE l."propertyId" = p.id 
              AND l."startDate" <= ${date.toISOString()}
            )`
          );
        }
      }
    }

    if (latitude && longitude) {
      const lat = parseFloat(latitude as string);
      const lng = parseFloat(longitude as string);
      const radiusInKilometers = 1000;
      const degrees = radiusInKilometers / 111; // Converts kilometers to degrees

      whereConditions.push(
        Prisma.sql`ST_DWithin(
          l.coordinates::geometry,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
          ${degrees}
        )`
      );
    }

    const completeQuery = Prisma.sql`
      SELECT 
        p.*,
        json_build_object(
          'id', l.id,
          'address', l.address,
          'city', l.city,
          'state', l.state,
          'country', l.country,
          'postalCode', l."postalCode",
          'coordinates', json_build_object(
            'longitude', ST_X(l."coordinates"::geometry),
            'latitude', ST_Y(l."coordinates"::geometry)
          )
        ) as location
      FROM "Property" p
      JOIN "Location" l ON p."locationId" = l.id
      ${
        whereConditions.length > 0
          ? Prisma.sql`WHERE ${Prisma.join(whereConditions, " AND ")}`
          : Prisma.empty
      }
    `;

    const properties = await prisma.$queryRaw(completeQuery);

    res.json(properties);
  } catch (error: any) {
    res
      .status(500)
      .json({ message: `Error retrieving properties: ${error.message}` });
  }
};

export const getProperty = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const property = await prisma.property.findUnique({
      where: { id },
      include: {
        location: true,
      },
    });

    if (property) {
      const coordinates: { coordinates: string }[] =
        await prisma.$queryRaw`SELECT ST_asText(coordinates) as coordinates from "Location" where id = ${property.location.id}::uuid`;

      const geoJSON: any = wktToGeoJSON(coordinates[0]?.coordinates || "");
      const longitude = geoJSON.coordinates[0];
      const latitude = geoJSON.coordinates[1];

      const propertyWithCoordinates = {
        ...property,
        location: {
          ...property.location,
          coordinates: {
            longitude,
            latitude,
          },
        },
      };
      res.json(propertyWithCoordinates);
    } else {
      res.status(404).json({ message: "Property not found" });
    }
  } catch (err: any) {
    res
      .status(500)
      .json({ message: `Error retrieving property: ${err.message}` });
  }
};

export const createProperty = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[];
    const authenticatedManagerId = req.user?.id;
    const {
      address,
      city,
      state,
      country,
      postalCode,
      ...propertyData
    } = req.body;

    console.log("Uploading count:", files.length);
    console.log("Uploading file:", files[0].originalname);

    const photoUrls = await uploadPropertyPhotos(files);
    const { longitude, latitude } = await getCoordinatesFromAddress({
      address,
      city,
      country,
      postalCode,
    });
    const locationId = randomUUID();

    // create location
    const [location] = await prisma.$queryRaw<RawLocationRow[]>`
    INSERT INTO "Location"
    (
      id,
      address,
      city,
      state,
      country,
      "postalCode",
      coordinates,
      "createdAt",
      "updatedAt"
    )
    VALUES
    (
      ${locationId}::uuid,
      ${address},
      ${city},
      ${state},
      ${country},
      ${postalCode},
      ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
      NOW(),
      NOW()
    )
    RETURNING
      id,
      address,
      city,
      state,
      country,
      "postalCode",
      ST_AsText(coordinates) as coordinates;
  `;

    // create property
    const newProperty = await prisma.property.create({
      data: {
        ...propertyData,
        photoUrls,
        locationId: location.id,
        managerCognitoId: authenticatedManagerId!,
        amenities:
          typeof propertyData.amenities === "string"
            ? (propertyData.amenities.split(",") as Amenity[])
            : [],
        highlights:
          typeof propertyData.highlights === "string"
            ? (propertyData.highlights.split(",") as Highlight[])
            : [],
        isPetsAllowed: propertyData.isPetsAllowed === "true",
        isParkingIncluded: propertyData.isParkingIncluded === "true",
        pricePerMonth: parseFloat(propertyData.pricePerMonth),
        securityDeposit: parseFloat(propertyData.securityDeposit),
        beds: parseInt(propertyData.beds),
        baths: parseFloat(propertyData.baths),
        squareFeet: parseInt(propertyData.squareFeet),
        propertyType: propertyData.propertyType as PropertyType,
      },
      include: {
        location: true,
        manager: true,
      },
    });

    res.status(201).json(newProperty);
  } catch (err: any) {
    res
      .status(500)
      .json({ message: `Error creating property: ${err.message}` });
  }
};

export const updateProperty = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const files = (req.files as Express.Multer.File[]) || [];

    const existingProperty = await prisma.property.findUnique({
      where: { id },
      include: {
        location: true,
      },
    });

    if (!existingProperty) {
      res.status(404).json({ message: "Property not found" });
      return;
    }

    const {
      address,
      city,
      state,
      country,
      postalCode,
      photoUrls,
      ...propertyData
    } = req.body;

    const uploadedPhotoUrls = await uploadPropertyPhotos(files);
    const incomingPhotoUrls = parseStringArray(photoUrls);
    const amenities = parseStringArray(propertyData.amenities);
    const highlights = parseStringArray(propertyData.highlights);
    const isPetsAllowed = parseBoolean(propertyData.isPetsAllowed);
    const isParkingIncluded = parseBoolean(propertyData.isParkingIncluded);
    const pricePerMonth = parseNumber(propertyData.pricePerMonth);
    const securityDeposit = parseNumber(propertyData.securityDeposit);
    const beds = parseNumber(propertyData.beds);
    const baths = parseNumber(propertyData.baths);
    const squareFeet = parseNumber(propertyData.squareFeet);
    const resolvedPhotoUrls =
      incomingPhotoUrls !== undefined
        ? [...incomingPhotoUrls, ...uploadedPhotoUrls]
        : uploadedPhotoUrls.length > 0
          ? [...existingProperty.photoUrls, ...uploadedPhotoUrls]
          : undefined;

    const nextAddress = address ?? existingProperty.location.address;
    const nextCity = city ?? existingProperty.location.city;
    const nextState = state ?? existingProperty.location.state;
    const nextCountry = country ?? existingProperty.location.country;
    const nextPostalCode = postalCode ?? existingProperty.location.postalCode;

    const locationChanged =
      address !== undefined ||
      city !== undefined ||
      state !== undefined ||
      country !== undefined ||
      postalCode !== undefined;

    if (locationChanged) {
      const { longitude, latitude } = await getCoordinatesFromAddress({
        address: nextAddress,
        city: nextCity,
        country: nextCountry,
        postalCode: nextPostalCode,
      });

      await prisma.$executeRaw`
        UPDATE "Location"
        SET
          address = ${nextAddress},
          city = ${nextCity},
          state = ${nextState},
          country = ${nextCountry},
          "postalCode" = ${nextPostalCode},
          coordinates = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
        WHERE id = ${existingProperty.location.id}::uuid
      `;
    }

    const updatedProperty = await prisma.property.update({
      where: { id },
      data: {
        ...(propertyData.name !== undefined && { name: propertyData.name }),
        ...(propertyData.description !== undefined && {
          description: propertyData.description,
        }),
        ...(propertyData.propertyType !== undefined && {
          propertyType: propertyData.propertyType as PropertyType,
        }),
        ...(resolvedPhotoUrls !== undefined && { photoUrls: resolvedPhotoUrls }),
        ...(amenities !== undefined && {
          amenities: amenities as Amenity[],
        }),
        ...(highlights !== undefined && {
          highlights: highlights as Highlight[],
        }),
        ...(isPetsAllowed !== undefined && {
          isPetsAllowed,
        }),
        ...(isParkingIncluded !== undefined && {
          isParkingIncluded,
        }),
        ...(pricePerMonth !== undefined && {
          pricePerMonth,
        }),
        ...(securityDeposit !== undefined && {
          securityDeposit,
        }),
        ...(beds !== undefined && {
          beds,
        }),
        ...(baths !== undefined && {
          baths,
        }),
        ...(squareFeet !== undefined && {
          squareFeet,
        }),
      },
      include: {
        location: true,
        manager: true,
      },
    });

    res.json(updatedProperty);
  } catch (err: any) {
    res
      .status(500)
      .json({ message: `Error updating property: ${err.message}` });
  }
};

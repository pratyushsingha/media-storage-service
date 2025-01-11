import prisma from "./db.js";

export const saveFaceMetadata = async (faceId, albumPin, imagePath) => {
  const saveToDB = await prisma.faceMetadata.create({
    data: {
      faceId,
      albumPin,
      imagePath: imagePath.split("/").slice(-1)[0],
    },
  });

  if (!saveToDB) {
    console.error(
      `Error saving metadata for faceId ${faceId} with albumPin ${albumPin}`
    );
    return;
  }

  console.log(`Saved metadata for faceId ${faceId} with albumPin ${albumPin}`);
};

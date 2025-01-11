-- CreateTable
CREATE TABLE "FaceMetadata" (
    "id" SERIAL NOT NULL,
    "faceId" TEXT NOT NULL,
    "albumPin" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceMetadata_pkey" PRIMARY KEY ("id")
);

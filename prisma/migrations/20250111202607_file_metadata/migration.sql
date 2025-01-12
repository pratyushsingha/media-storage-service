/*
  Warnings:

  - The primary key for the `FaceMetadata` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[id]` on the table `FaceMetadata` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "FaceMetadata" DROP CONSTRAINT "FaceMetadata_pkey",
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ADD CONSTRAINT "FaceMetadata_pkey" PRIMARY KEY ("id");
DROP SEQUENCE "FaceMetadata_id_seq";

-- CreateIndex
CREATE UNIQUE INDEX "FaceMetadata_id_key" ON "FaceMetadata"("id");

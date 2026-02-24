-- CreateEnum
CREATE TYPE "SketchType" AS ENUM ('soulmate', 'baby');

-- CreateTable
CREATE TABLE "Sketch" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "SketchType" NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sketch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sketch_userId_type_idx" ON "Sketch"("userId", "type");

-- AddForeignKey
ALTER TABLE "Sketch" ADD CONSTRAINT "Sketch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

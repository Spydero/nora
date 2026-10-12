/*
  Warnings:

  - You are about to drop the column `how_it_works` on the `medicine_entries` table. All the data in the column will be lost.
  - You are about to drop the column `when_to_seek_help` on the `medicine_entries` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "medicine_entries" DROP COLUMN "how_it_works",
DROP COLUMN "when_to_seek_help",
ADD COLUMN     "ask_clinician_if" TEXT[],
ADD COLUMN     "otc" BOOLEAN NOT NULL DEFAULT false;

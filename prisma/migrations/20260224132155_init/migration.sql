-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('ru', 'en');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('none', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "HoroscopePeriod" AS ENUM ('day', 'week', 'month');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "locale" "Locale" NOT NULL DEFAULT 'ru',
    "subscription" "SubscriptionStatus" NOT NULL DEFAULT 'none',
    "subscriptionEndsAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripePaymentMethodId" TEXT,
    "quizResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Horoscope" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "period" "HoroscopePeriod" NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Horoscope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLink" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "LoginLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Horoscope_userId_period_idx" ON "Horoscope"("userId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "LoginLink_token_key" ON "LoginLink"("token");

-- AddForeignKey
ALTER TABLE "Horoscope" ADD CONSTRAINT "Horoscope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginLink" ADD CONSTRAINT "LoginLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, createSessionToken } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") || "");

  if (!process.env.SITE_PASSWORD) {
    throw new Error("SITE_PASSWORD is not set in the deployment's environment variables.");
  }

  if (password !== process.env.SITE_PASSWORD) {
    redirect("/login?error=1");
  }

  const store = await cookies();
  store.set(AUTH_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect("/");
}

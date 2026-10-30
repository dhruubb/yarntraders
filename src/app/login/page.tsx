import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { LoginForm } from "@/components/client/LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-xl bg-surface p-7 shadow-2xl">
        <h1 className="text-xl font-semibold">Yarn register</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Sign in to enter sales, purchases and payments.</p>
        <LoginForm />
      </div>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { loginAction } from "@/app/actions";
import { btn, input, label } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  // Controlled so a wrong password doesn't clear the username (React resets uncontrolled forms after an action)
  const [username, setUsername] = useState("");
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="username" className={label}>Username</label>
        <input id="username" name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required className={input} autoFocus />
      </div>
      <div>
        <label htmlFor="password" className={label}>Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={input} />
      </div>
      {state?.error && <p role="alert" className="rounded-md bg-madder-tint px-3 py-2 text-sm text-madder">{state.error}</p>}
      <button disabled={pending} className={`${btn.primary} w-full py-2.5`}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

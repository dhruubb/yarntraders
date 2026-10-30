"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatIndian } from "@/lib/calc";

const short = (v: number) => (v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));

export function SalesChart({ data }: { data: { day: string; sales: number; purchases: number }[] }) {
  return (
    <div className="h-60 w-full" role="img" aria-label="Sales and purchases for the last 30 days">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={1}>
          <CartesianGrid vertical={false} stroke="#dfe2ea" />
          <XAxis dataKey="day" tickFormatter={(d: string) => String(Number(d.slice(8)))} tick={{ fontSize: 11, fill: "#5f6880" }} tickLine={false} axisLine={false} interval={2} />
          <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "#5f6880" }} tickLine={false} axisLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "#e8ebf6" }}
            formatter={(v, name) => [`₹${formatIndian(Number(v), 0)}`, name === "sales" ? "Sales" : "Purchases"]}
            labelFormatter={(d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            contentStyle={{ borderRadius: 6, border: "1px solid #dfe2ea", fontSize: 13 }}
          />
          <Bar dataKey="purchases" fill="#b9c0dc" radius={[2, 2, 0, 0]} />
          <Bar dataKey="sales" fill="#1e2650" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ink" /> Sales</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#b9c0dc]" /> Purchases</span>
        <span>Taxable value, before GST</span>
      </div>
    </div>
  );
}

import { ComingSoonPage } from "@/components/ComingSoonPage";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Gym Buddy — Free Workout Planner & Tracker (Coming Soon)",
  description: "Plan workouts, log sets and track progress with Gym Buddy, a free workout planner. Coming soon to Buddy.",
  path: "/gym-buddy",
  keywords: ["workout planner", "gym tracker", "workout log app"],
});

export default function Page() {
  return <ComingSoonPage id="gym-buddy" points={["Build weekly workout plans", "Log sets, reps and weight", "See progress charts over time"]} />;
}

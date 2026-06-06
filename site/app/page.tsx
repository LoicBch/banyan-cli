/**
 * Single-page landing. Order matters: hook them on the hero, prove it with
 * the terminal demo, expand into features, walk them through the steps,
 * close with a CTA.
 */
import { Nav } from "@/components/Nav";
import { Hero } from "@/components/Hero";
import { Terminal } from "@/components/Terminal";
import { Features } from "@/components/Features";
import { HowItWorks } from "@/components/HowItWorks";
import { CTA } from "@/components/CTA";
import { Footer } from "@/components/Footer";

export default function HomePage(): React.JSX.Element {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Terminal />
        <Features />
        <HowItWorks />
        <CTA />
      </main>
      <Footer />
    </>
  );
}

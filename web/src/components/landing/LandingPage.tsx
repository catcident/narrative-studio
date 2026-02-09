import { LandingHeader } from './LandingHeader';
import { HeroSection } from './HeroSection';
import { HowItWorks } from './HowItWorks';
import { FeaturesSection } from './FeaturesSection';
import { ChatShowcase } from './ChatShowcase';
import { PricingSection } from './PricingSection';
import { FinalCTA } from './FinalCTA';
import { Footer } from '@/components/Footer';

export function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <LandingHeader />
      <main className="flex-1">
        <HeroSection />
        <HowItWorks />
        <FeaturesSection />
        <ChatShowcase />
        <PricingSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}

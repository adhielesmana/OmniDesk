import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme-toggle";
import { 
  MessageSquare, 
  Users, 
  Zap, 
  Shield, 
  BarChart3, 
  Clock,
  CheckCircle2,
  ArrowRight,
  Send,
  Bot,
  Smartphone
} from "lucide-react";
import { SiWhatsapp, SiInstagram, SiFacebook } from "react-icons/si";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <MessageSquare className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">OmniDesk</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#benefits" className="text-muted-foreground hover:text-foreground transition-colors">Benefits</a>
            <a href="#platforms" className="text-muted-foreground hover:text-foreground transition-colors">Platforms</a>
          </nav>
          
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="outline" data-testid="button-login">Login</Button>
            </Link>
            <Link href="/login">
              <Button data-testid="button-get-started">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium">
                <Zap className="w-4 h-4" />
                Unified Messaging Platform
              </div>
              
              <h1 className="text-4xl lg:text-6xl font-bold leading-tight">
                All Your Messages,{" "}
                <span className="text-primary">One Inbox</span>
              </h1>
              
              <p className="text-xl text-muted-foreground max-w-lg">
                Consolidate WhatsApp, Instagram, and Facebook conversations into a single powerful dashboard. 
                Never miss a customer message again.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/login">
                  <Button size="lg" className="gap-2" data-testid="button-hero-start">
                    Start Free Trial
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                </Link>
                <a href="#features">
                  <Button size="lg" variant="outline" data-testid="button-hero-features">
                    See Features
                  </Button>
                </a>
              </div>
              
              <div className="flex items-center gap-8 pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  <span className="text-sm text-muted-foreground">No credit card required</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  <span className="text-sm text-muted-foreground">14-day free trial</span>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-card rounded-2xl shadow-2xl border p-6 space-y-4">
                <div className="flex items-center gap-3 pb-4 border-b">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-4 text-sm font-medium">OmniDesk Inbox</span>
                </div>
                
                <div className="grid grid-cols-4 gap-2">
                  <div className="col-span-1 space-y-2 border-r pr-2">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <MessageSquare className="w-5 h-5 text-primary mx-auto" />
                    </div>
                    <div className="p-2 hover:bg-muted rounded-lg">
                      <SiWhatsapp className="w-5 h-5 text-green-500 mx-auto" />
                    </div>
                    <div className="p-2 hover:bg-muted rounded-lg">
                      <SiInstagram className="w-5 h-5 text-pink-500 mx-auto" />
                    </div>
                    <div className="p-2 hover:bg-muted rounded-lg">
                      <SiFacebook className="w-5 h-5 text-blue-500 mx-auto" />
                    </div>
                  </div>
                  
                  <div className="col-span-3 space-y-2">
                    {[
                      { name: "John Doe", msg: "Hi, I need help with my order", time: "2m", platform: "whatsapp", unread: true },
                      { name: "Sarah Smith", msg: "When will my package arrive?", time: "5m", platform: "instagram", unread: true },
                      { name: "Mike Johnson", msg: "Thanks for the quick response!", time: "12m", platform: "facebook", unread: false },
                    ].map((chat, i) => (
                      <div key={i} className={`p-3 rounded-lg flex items-center gap-3 ${chat.unread ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted'}`}>
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center font-medium">
                          {chat.name[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{chat.name}</span>
                            <span className="text-xs text-muted-foreground">{chat.time}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{chat.msg}</p>
                        </div>
                        {chat.unread && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="absolute -bottom-4 -right-4 bg-card rounded-xl shadow-xl border p-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <SiWhatsapp className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">WhatsApp Connected</p>
                  <p className="text-xs text-muted-foreground">Real-time sync active</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 border-b">
        <div className="container mx-auto px-4">
          <p className="text-center text-muted-foreground mb-8">Trusted by businesses worldwide</p>
          <div className="flex flex-wrap items-center justify-center gap-12 opacity-60">
            <div className="flex items-center gap-2">
              <SiWhatsapp className="w-8 h-8" />
              <span className="font-semibold">WhatsApp Business</span>
            </div>
            <div className="flex items-center gap-2">
              <SiInstagram className="w-8 h-8" />
              <span className="font-semibold">Instagram API</span>
            </div>
            <div className="flex items-center gap-2">
              <SiFacebook className="w-8 h-8" />
              <span className="font-semibold">Messenger API</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              Everything You Need to Manage Customer Conversations
            </h2>
            <p className="text-lg text-muted-foreground">
              Powerful features designed to streamline your communication workflow and boost customer satisfaction
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: MessageSquare,
                title: "Unified Inbox",
                description: "View and respond to all your WhatsApp, Instagram, and Facebook messages from one centralized dashboard"
              },
              {
                icon: Bot,
                title: "Auto-Reply System",
                description: "Set up intelligent auto-responses based on keywords, time of day, or contact tags to never leave customers waiting"
              },
              {
                icon: Send,
                title: "Blast Campaigns",
                description: "Send targeted messages to thousands of contacts with personalized templates and scheduling"
              },
              {
                icon: Users,
                title: "Team Collaboration",
                description: "Assign conversations to team members, create departments, and track performance across your organization"
              },
              {
                icon: Shield,
                title: "Secure & Reliable",
                description: "Enterprise-grade security with encrypted connections, session management, and role-based access control"
              },
              {
                icon: BarChart3,
                title: "Analytics & Insights",
                description: "Track message delivery, response times, and customer engagement with detailed reporting"
              }
            ].map((feature, i) => (
              <Card key={i} className="hover-elevate transition-all duration-300">
                <CardContent className="p-6 space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <feature.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="benefits" className="py-20 lg:py-32 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-8">
              <h2 className="text-3xl lg:text-4xl font-bold">
                Save Time, Increase Efficiency
              </h2>
              <p className="text-lg text-muted-foreground">
                Stop switching between apps. OmniDesk brings all your messaging platforms together so you can focus on what matters most - your customers.
              </p>
              
              <div className="space-y-6">
                {[
                  { icon: Clock, title: "80% Faster Response Time", desc: "Respond to customers instantly without switching apps" },
                  { icon: Users, title: "Manage 10x More Conversations", desc: "Handle more customer inquiries with less effort" },
                  { icon: Zap, title: "Automate Repetitive Tasks", desc: "Set up quick replies and auto-responses to save hours daily" }
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <item.icon className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold mb-1">{item.title}</h4>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <Card className="p-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">50K+</div>
                <p className="text-sm text-muted-foreground">Messages Handled Daily</p>
              </Card>
              <Card className="p-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">99.9%</div>
                <p className="text-sm text-muted-foreground">Uptime Guarantee</p>
              </Card>
              <Card className="p-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">24/7</div>
                <p className="text-sm text-muted-foreground">Auto-Reply Available</p>
              </Card>
              <Card className="p-6 text-center">
                <div className="text-4xl font-bold text-primary mb-2">3+</div>
                <p className="text-sm text-muted-foreground">Platforms Integrated</p>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <section id="platforms" className="py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              Connect All Your Messaging Platforms
            </h2>
            <p className="text-lg text-muted-foreground">
              Integrate with the platforms your customers use most
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <Card className="p-8 text-center hover-elevate">
              <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
                <SiWhatsapp className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">WhatsApp</h3>
              <p className="text-muted-foreground text-sm">
                Connect via official Twilio Business API or direct QR code scan for instant messaging
              </p>
            </Card>
            
            <Card className="p-8 text-center hover-elevate">
              <div className="w-20 h-20 rounded-full bg-pink-500/10 flex items-center justify-center mx-auto mb-6">
                <SiInstagram className="w-10 h-10 text-pink-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Instagram</h3>
              <p className="text-muted-foreground text-sm">
                Manage Instagram DMs directly from your dashboard with full message history
              </p>
            </Card>
            
            <Card className="p-8 text-center hover-elevate">
              <div className="w-20 h-20 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-6">
                <SiFacebook className="w-10 h-10 text-blue-500" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Facebook</h3>
              <p className="text-muted-foreground text-sm">
                Handle Facebook Messenger conversations for your business page seamlessly
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 lg:py-32 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl lg:text-4xl font-bold mb-6">
            Ready to Transform Your Customer Communication?
          </h2>
          <p className="text-xl opacity-90 max-w-2xl mx-auto mb-8">
            Join thousands of businesses already using OmniDesk to deliver exceptional customer experiences
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login">
              <Button size="lg" variant="secondary" className="gap-2" data-testid="button-cta-start">
                Start Your Free Trial
                <ArrowRight className="w-5 h-5" />
              </Button>
            </Link>
          </div>
          <p className="mt-6 text-sm opacity-75">
            No credit card required. 14-day free trial.
          </p>
        </div>
      </section>

      <footer className="py-12 border-t">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="text-lg font-bold">OmniDesk</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Unified messaging platform for modern businesses
              </p>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground">Features</a></li>
                <li><a href="#benefits" className="hover:text-foreground">Benefits</a></li>
                <li><a href="#platforms" className="hover:text-foreground">Integrations</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Platforms</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>WhatsApp Business</li>
                <li>Instagram Messaging</li>
                <li>Facebook Messenger</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold mb-4">Connect</h4>
              <div className="flex gap-4">
                <Smartphone className="w-5 h-5 text-muted-foreground" />
                <SiWhatsapp className="w-5 h-5 text-muted-foreground" />
                <SiInstagram className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>
          </div>
          
          <div className="border-t pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} OmniDesk. All rights reserved.
            </p>
            <p className="text-sm text-muted-foreground">
              Made with care for better customer communication
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

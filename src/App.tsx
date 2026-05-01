import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Capture from "./pages/Capture";
import Plan from "./pages/Plan";
import Replan from "./pages/Replan";
import Focus from "./pages/Focus";
import Workload from "./pages/Workload";
import CalendarView from "./pages/Calendar";
import TaskDetail from "./pages/TaskDetail";
import Onboarding from "./pages/Onboarding";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import RequireAuth from "./components/RequireAuth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
            <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
            <Route path="/capture" element={<RequireAuth><Capture /></RequireAuth>} />
            <Route path="/plan" element={<RequireAuth><Plan /></RequireAuth>} />
            <Route path="/replan" element={<RequireAuth><Replan /></RequireAuth>} />
            <Route path="/focus" element={<RequireAuth><Focus /></RequireAuth>} />
            <Route path="/workload" element={<RequireAuth><Workload /></RequireAuth>} />
            <Route path="/calendar" element={<RequireAuth><CalendarView /></RequireAuth>} />
            <Route path="/task/:id" element={<RequireAuth><TaskDetail /></RequireAuth>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

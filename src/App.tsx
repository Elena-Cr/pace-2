import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
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
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/capture" element={<Capture />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/replan" element={<Replan />} />
            <Route path="/focus" element={<Focus />} />
            <Route path="/workload" element={<Workload />} />
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/task/:id" element={<TaskDetail />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

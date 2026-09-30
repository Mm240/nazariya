import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import About from './pages/About';
import Admin from './pages/Admin';
import Blindspots from './pages/Blindspots';
import Home from './pages/Home';
import NotFound from './pages/NotFound';
import Outlets from './pages/Outlets';
import Search from './pages/Search';
import Story from './pages/Story';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="story/:id" element={<Story />} />
          <Route path="blindspots" element={<Blindspots />} />
          <Route path="search" element={<Search />} />
          <Route path="outlets" element={<Outlets />} />
          <Route path="about" element={<About />} />
          <Route path="admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

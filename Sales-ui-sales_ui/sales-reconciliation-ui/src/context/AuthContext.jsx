import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext();

// API Configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://localhost:7276/api';

const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const isTokenValid = (token) => {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // If the token has no exp claim, treat it as valid and let the backend reject it
    if (!payload.exp) return true;
    return payload.exp * 1000 > Date.now();
  } catch {
    // Can't decode — still has a token string, allow through and let backend decide
    return true;
  }
};

axiosInstance.interceptors.request.use((config) => {
  const user = localStorage.getItem('user');
  if (user) {
    const userData = JSON.parse(user);
    if (userData.token) {
      config.headers.Authorization = `Bearer ${userData.token}`;
    }
  }
  return config;
});

axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url ?? '';
    const isAuthCall = url.includes('login') || url.includes('register') || url.includes('forgot-password');
    if (error.response?.status === 401 && !isAuthCall) {
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        if (isTokenValid(userData.token)) {
          setUser(userData);
        } else {
          localStorage.removeItem('user');
        }
      } catch {
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const register = async (email, password, confirmPassword, role, name) => {
    setError(null);
    try {
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      // Call backend API
      const response = await axiosInstance.post('/auth/register', {
        email,
        password,
        role,
        name,
      });

      const userData = {
        id: response.data.userId,
        email: response.data.email,
        name: response.data.name,
        role: response.data.role,
        permissions: response.data.permissions ?? [],
        token: response.data.token,
      };

      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      return userData;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'Registration failed';
      setError(errorMsg);
      throw err;
    }
  };

  const login = async (email, password, role) => {
    setError(null);
    try {
      // Call backend API
      const response = await axiosInstance.post('/auth/login', {
        email,
        password,
        role,
      });

    const userData = {
    id: response.data.user.userId,
    email: response.data.user.email,
    name: response.data.user.name,
    role: response.data.user.role,
    permissions: response.data.user.permissions ?? [],
    token: response.data.token
};

      localStorage.setItem('user', JSON.stringify(userData));
      setUser(userData);
      return userData;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'Login failed';
      setError(errorMsg);
      console.log
      throw err;
    }
  };

  const logout = () => {
    localStorage.removeItem('user');
    setUser(null);
    setError(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, register, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

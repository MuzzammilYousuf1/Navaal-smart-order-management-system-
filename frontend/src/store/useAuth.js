import { create } from "zustand";

const useAuth = create((set) => ({
  user: JSON.parse(localStorage.getItem("sof_user") || "null"),
  token: localStorage.getItem("sof_token") || null,

  login: (token, user) => {
    localStorage.setItem("sof_token", token);
    localStorage.setItem("sof_user", JSON.stringify(user));
    set({ token, user });
  },

  logout: () => {
    localStorage.removeItem("sof_token");
    localStorage.removeItem("sof_user");
    set({ token: null, user: null });
  },
}));

export default useAuth;

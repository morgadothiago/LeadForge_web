"use client";

import * as React from "react";
import { motion } from "framer-motion";

/**
 * SPEC-035 — microinteração sutil de rolagem (fade + slide-up ao entrar na viewport), pedida na
 * SPEC ("framer-motion para microinteracoes sutis... sem exagero"). `viewport.once` evita reanimar
 * repetidamente ao rolar pra cima/baixo.
 */
export function FadeInSection({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

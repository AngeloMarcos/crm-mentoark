import React, { useState } from 'react';
import { ChatMessage } from '@/components/openclaw/ChatMessage';
import { StatusCard } from '@/components/openclaw/StatusCard';
import { FileConfigCard } from '@/components/openclaw/FileConfigCard';

import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Terminal, Server, Bot, Database, Zap, RefreshCw, Copy, Send, LayoutGrid } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

export default function OpenClawPage() {
  return (
    <div className="p-6 space-y-6 bg-[#0a0a0a] min-h-screen text-gray-100">
      <div className="flex items-center gap-3">
        <Terminal className="w-8 h-8 text-blue-500" />
        <h1 className="text-2xl font-bold">OpenClaw Administration</h1>
      </div>

      <Tabs defaultValue="chat" className="space-y-4">
        <TabsList className="bg-[#111]">
          <TabsTrigger value="chat" className="data-[state=active]:bg-[#222]">Chat Admin</TabsTrigger>
          <TabsTrigger value="status" className="data-[state=active]:bg-[#222]">Status & Diagnóstico</TabsTrigger>
          <TabsTrigger value="config" className="data-[state=active]:bg-[#222]">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="h-[600px] border border-[#222] rounded-lg bg-[#111] flex overflow-hidden">
          <div className="w-[240px] border-r border-[#222] p-4 flex flex-col gap-2">
            <Button variant="outline" size="sm" className="w-full justify-start gap-2">
              <span className="text-xl">+</span> Nova Conversa
            </Button>
            <div className="space-y-1 mt-4">
              {["🔧 VPS Admin", "📊 Diagnóstico", "🐳 Docker", "📝 Código"].map(item => (
                <div key={item} className="text-sm p-2 rounded hover:bg-[#222] cursor-pointer text-gray-400">{item}</div>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Badge variant="outline" className="cursor-pointer hover:bg-blue-900">docker ps</Badge>
                  <Badge variant="outline" className="cursor-pointer hover:bg-blue-900">df -h</Badge>
                </div>
                <div className="text-gray-500 italic text-sm text-center">Nenhuma mensagem ainda...</div>
              </div>
            </ScrollArea>
            <div className="p-4 border-t border-[#222] bg-[#111]">
              <div className="flex gap-2">
                <Textarea placeholder="Peça ao agente..." className="bg-[#0a0a0a] border-[#222]" />
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="status" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatusCard title="OpenClaw Gateway" status="online" info="gpt-5.4-mini" indicatorText="Ativo" />
            <StatusCard title="Backend API" status="online" info="Online" indicatorText="Ativo" />
            <StatusCard title="Evolution API" status="online" info="3 Instâncias" indicatorText="Conectado" />
            <StatusCard title="Banco de Dados" status="online" info="PostgreSQL 16" indicatorText="Online" />
          </div>
        </TabsContent>


        <TabsContent value="config">
          <Card className="p-4 bg-[#111] border-[#222]">
            <h2 className="text-lg font-bold mb-4">Workspace Files</h2>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
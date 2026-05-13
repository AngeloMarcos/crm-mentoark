import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Upload, Download, Loader2, Eraser, Trash2 } from "lucide-react";
import { removeBackground, loadImage } from "@/utils/removeBackground";
import { toast } from "sonner";

interface BackgroundRemoverModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProcessed?: (blob: Blob) => void;
}

export function BackgroundRemoverModal({ open, onOpenChange, onProcessed }: BackgroundRemoverModalProps) {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setProcessedImage(null);
      setProcessedBlob(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        setOriginalImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveBackground = async () => {
    if (!selectedFile) {
      toast.error("Selecione uma imagem primeiro");
      return;
    }

    setIsProcessing(true);
    try {
      toast.info("Processando... Isso pode levar alguns segundos na primeira vez (baixando modelos)");
      
      const imageElement = await loadImage(selectedFile);
      const resultBlob = await removeBackground(imageElement);
      
      const url = URL.createObjectURL(resultBlob);
      setProcessedImage(url);
      setProcessedBlob(resultBlob);
      
      toast.success("Fundo removido com sucesso!");
    } catch (error) {
      console.error("Error:", error);
      toast.error("Erro ao processar imagem. Verifique se seu navegador suporta WebGPU ou tente novamente.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = () => {
    if (processedBlob && onProcessed) {
      onProcessed(processedBlob);
      onOpenChange(false);
      reset();
    }
  };

  const reset = () => {
    setOriginalImage(null);
    setProcessedImage(null);
    setSelectedFile(null);
    setProcessedBlob(null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if(!o) reset(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eraser className="h-5 w-5" /> Remover Fundo da Imagem
          </DialogTitle>
        </DialogHeader>
        
        <div className="grid md:grid-cols-2 gap-6 my-4">
          {/* Original */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Original</h3>
            <div className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border">
              {originalImage ? (
                <img src={originalImage} alt="Original" className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-center text-muted-foreground p-4">
                  <Upload className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">Clique em "Selecionar" para começar</p>
                </div>
              )}
            </div>
          </div>

          {/* Processed */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Sem Fundo (Preview)</h3>
            <div 
              className="aspect-square bg-muted rounded-lg flex items-center justify-center overflow-hidden border relative"
              style={{
                backgroundImage: processedImage ? 'linear-gradient(45deg, #eee 25%, transparent 25%), linear-gradient(-45deg, #eee 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eee 75%), linear-gradient(-45deg, transparent 75%, #eee 75%)' : 'none',
                backgroundSize: '20px 20px',
                backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
              }}
            >
              {processedImage ? (
                <img src={processedImage} alt="Processed" className="max-w-full max-h-full object-contain relative z-10" />
              ) : (
                <div className="text-center text-muted-foreground p-4">
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin text-primary" />
                      <p className="text-xs">Processando...</p>
                    </>
                  ) : (
                    <p className="text-xs opacity-50">O resultado aparecerá aqui</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex-1 flex gap-2">
            <label className="cursor-pointer">
              <Input type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
              <Button variant="outline" asChild>
                <span><Upload className="w-4 h-4 mr-2" /> Selecionar</span>
              </Button>
            </label>
            {selectedFile && (
              <Button onClick={handleRemoveBackground} disabled={isProcessing}>
                {isProcessing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eraser className="w-4 h-4 mr-2" />}
                Remover Fundo
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            {processedImage && (
              <Button onClick={handleSave} variant="default">
                Usar na Galeria
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

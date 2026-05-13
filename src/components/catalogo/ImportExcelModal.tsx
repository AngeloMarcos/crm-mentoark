import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet, AlertCircle, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface ImportExcelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (data: any[]) => void;
}

export function ImportExcelModal({ open, onOpenChange, onImported }: ImportExcelModalProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any[] | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: "binary" });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const jsonData = XLSX.utils.sheet_to_json(ws);
      setData(jsonData);
      setLoading(false);
    };
    reader.readAsBinaryString(file);
  };

  const confirmImport = () => {
    if (data) {
      onImported(data);
      onOpenChange(false);
      setData(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            Importar Produtos via Excel
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="bg-muted p-4 rounded-lg text-xs space-y-2">
            <p className="font-semibold flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> Formato esperado:
            </p>
            <ul className="list-disc list-inside opacity-70">
              <li>Colunas: nome, descricao, preco, codigo, estoque</li>
              <li>O campo 'nome' é obrigatório</li>
              <li>Pode incluir outras colunas que serão salvas como campos extras</li>
            </ul>
          </div>

          {!data ? (
            <div className="border-2 border-dashed rounded-lg p-10 text-center space-y-3">
              {loading ? (
                <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
              ) : (
                <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground opacity-50" />
              )}
              <div>
                <label className="cursor-pointer">
                  <span className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium">
                    Selecionar Arquivo
                  </span>
                  <input type="file" hidden accept=".xlsx, .xls, .csv" onChange={handleFile} />
                </label>
              </div>
              <p className="text-[10px] text-muted-foreground">Excel (.xlsx) ou CSV</p>
            </div>
          ) : (
            <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg flex items-center gap-3">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <div>
                <p className="text-sm font-medium">{data.length} produtos encontrados</p>
                <p className="text-xs text-muted-foreground">Clique em confirmar para importar</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {data && (
            <Button onClick={confirmImport}>Confirmar Importação</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Copy, Eye, Trash2 } from "lucide-react";
import type { Flow } from "@/lib/wa-api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  flows: Flow[];
  onEdit: (flow: Flow) => void;
  onDuplicate: (flow: Flow) => void;
  onDelete: (id: string) => void;
}

export function AllFlowsModal({ open, onOpenChange, flows, onEdit, onDuplicate, onDelete }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Todos los flujos</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-full pr-4">
          {flows.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              No hay flujos guardados. Crea uno nuevo.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {flows.map((flow) => (
                <Card key={flow.id} className="overflow-hidden">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base truncate">{flow.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="pb-2 text-sm text-muted-foreground">
                    <div>🔑 {flow.keywords.length} palabra(s) clave</div>
                    <div>📝 {flow.steps.length} paso(s)</div>
                  </CardContent>
                  <CardFooter className="flex justify-end gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(flow)}
                    >
                      <Eye className="size-4 mr-1" /> Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onDuplicate(flow)}
                    >
                      <Copy className="size-4 mr-1" /> Duplicar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => onDelete(flow.id)}
                    >
                      <Trash2 className="size-4 mr-1" /> Eliminar
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
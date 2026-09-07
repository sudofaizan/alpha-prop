//+------------------------------------------------------------------+
//| TickPublisher.mq5 — push OnTick quotes to AlphaFX Tick Hub       |
//+------------------------------------------------------------------+
#property copyright "AlphaFX"
#property version   "1.00"
#property strict

input string InpHubHost   = "127.0.0.1";
input int    InpHubPort   = 9001;
input string InpSymbols   = "EURUSD,XAUUSD,BTCUSD,GBPUSD,USDJPY";
input int    InpTimerMs   = 100;
input int    InpReconnect = 5;

int    socketHandle = INVALID_HANDLE;
string symbols[];
double lastBid[];
datetime lastSend = 0;

//+------------------------------------------------------------------+
int OnInit()
  {
   StringSplit(InpSymbols, ',', symbols);
   ArrayResize(lastBid, ArraySize(symbols));
   ArrayInitialize(lastBid, 0.0);
   EventSetMillisecondTimer(InpTimerMs);
   if(!ConnectHub())
      Print("TickPublisher: waiting for hub at ", InpHubHost, ":", InpHubPort);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   DisconnectHub();
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   if(socketHandle == INVALID_HANDLE)
     {
      ConnectHub();
      return;
     }
   for(int i = 0; i < ArraySize(symbols); i++)
      PublishSymbol(symbols[i], i);
   SendHeartbeat();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   if(socketHandle == INVALID_HANDLE)
      return;
   int idx = SymbolIndex(_Symbol);
   if(idx >= 0)
      PublishSymbol(_Symbol, idx);
  }

//+------------------------------------------------------------------+
int SymbolIndex(string sym)
  {
   string s = sym;
   for(int i = 0; i < ArraySize(symbols); i++)
      if(symbols[i] == s)
         return i;
   return -1;
  }

//+------------------------------------------------------------------+
void PublishSymbol(string sym, int idx)
  {
   MqlTick tick;
   if(!SymbolInfoTick(sym, tick))
      return;
   if(tick.bid <= 0 || tick.ask <= 0)
      return;
   if(MathAbs(tick.bid - lastBid[idx]) < 0.0000001)
      return;
   lastBid[idx] = tick.bid;

   string json = StringFormat(
      "{\"type\":\"tick\",\"symbol\":\"%s\",\"bid\":%.10f,\"ask\":%.10f,\"time_ms\":%I64d,\"source\":\"mt5\"}\n",
      sym,
      tick.bid,
      tick.ask,
      (long)tick.time_msc
   );
   SendLine(json);
  }

//+------------------------------------------------------------------+
void SendHeartbeat()
  {
   if(TimeCurrent() - lastSend < InpReconnect)
      return;
   SendLine("{\"type\":\"heartbeat\"}\n");
   lastSend = TimeCurrent();
  }

//+------------------------------------------------------------------+
bool ConnectHub()
  {
   DisconnectHub();
   socketHandle = SocketCreate();
   if(socketHandle == INVALID_HANDLE)
     {
      Print("TickPublisher: SocketCreate failed ", GetLastError());
      return false;
     }
   if(!SocketConnect(socketHandle, InpHubHost, InpHubPort, 2000))
     {
      Print("TickPublisher: connect failed ", GetLastError());
      SocketClose(socketHandle);
      socketHandle = INVALID_HANDLE;
      return false;
     }
   Print("TickPublisher: connected to hub ", InpHubHost, ":", InpHubPort);
   return true;
  }

//+------------------------------------------------------------------+
void DisconnectHub()
  {
   if(socketHandle != INVALID_HANDLE)
     {
      SocketClose(socketHandle);
      socketHandle = INVALID_HANDLE;
     }
  }

//+------------------------------------------------------------------+
void SendLine(string line)
  {
   if(socketHandle == INVALID_HANDLE)
      return;
   uchar data[];
   int len = StringToCharArray(line, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   if(len <= 0)
      return;
   int sent = SocketSend(socketHandle, data, len);
   if(sent != len)
     {
      Print("TickPublisher: send failed, reconnecting");
      DisconnectHub();
     }
  }
//+------------------------------------------------------------------+

"""アプリケーション層（ユースケース）。

ここは「何をするか」を書く場所で、「どうやるか」は知らない。
外側（infrastructure）へはすべて ports.py の Protocol 越しに触る。
依存の向きは常に内向き: interface → application → domain。
"""
